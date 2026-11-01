use anyhow::Context;
use clip_core::{
    APP_ID, ClipItem, NewImageCapture, NewTextCapture, OBJECT_PATH, data_dir as default_data_dir,
};
use clip_store::Store;
use std::path::PathBuf;
use std::sync::Mutex;
use tracing_subscriber::EnvFilter;
use zbus::Connection;

pub const SERVICE_NAME: &str = APP_ID;
pub const SERVICE_PATH: &str = OBJECT_PATH;

pub struct CliporiumService {
    store: Mutex<Store>,
}

impl CliporiumService {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
        }
    }

    fn lock_store(&self) -> zbus::fdo::Result<std::sync::MutexGuard<'_, Store>> {
        self.store
            .lock()
            .map_err(|_| zbus::fdo::Error::Failed("clipboard store lock poisoned".to_string()))
    }
}

fn to_fdo(error: impl std::fmt::Display) -> zbus::fdo::Error {
    zbus::fdo::Error::Failed(error.to_string())
}

fn items_json(items: Vec<ClipItem>) -> zbus::fdo::Result<String> {
    serde_json::to_string(&items).map_err(to_fdo)
}

#[zbus::interface(interface = "io.github.cliporium.Cliporium")]
impl CliporiumService {
    fn ping(&self) -> String {
        "pong".to_string()
    }

    fn capture_text(&self, text: &str, source_app: &str) -> zbus::fdo::Result<String> {
        let store = self.lock_store()?;
        let item = store
            .capture_text(NewTextCapture {
                text,
                source_app: Some(source_app),
            })
            .map_err(to_fdo)?;
        Ok(item.id)
    }

    fn capture_image(
        &self,
        mime: &str,
        bytes: Vec<u8>,
        source_app: &str,
    ) -> zbus::fdo::Result<String> {
        let store = self.lock_store()?;
        let item = store
            .capture_image(NewImageCapture {
                mime,
                bytes: &bytes,
                source_app: Some(source_app),
            })
            .map_err(to_fdo)?;
        Ok(item.id)
    }

    fn search(&self, query: &str, limit: u32) -> zbus::fdo::Result<String> {
        let store = self.lock_store()?;
        items_json(store.search(query, limit).map_err(to_fdo)?)
    }

    fn recent(&self, limit: u32) -> zbus::fdo::Result<String> {
        let store = self.lock_store()?;
        items_json(store.recent(limit).map_err(to_fdo)?)
    }

    fn get_blob(&self, id: &str) -> zbus::fdo::Result<Vec<u8>> {
        let store = self.lock_store()?;
        store.read_blob(id).map_err(to_fdo)
    }

    fn set_pinned(&self, id: &str, pinned: bool) -> zbus::fdo::Result<()> {
        let store = self.lock_store()?;
        store.set_pinned(id, pinned).map_err(to_fdo)
    }

    fn delete(&self, id: &str) -> zbus::fdo::Result<()> {
        let store = self.lock_store()?;
        store.delete(id).map_err(to_fdo)
    }
}

#[zbus::proxy(
    interface = "io.github.cliporium.Cliporium",
    default_service = "io.github.cliporium.Cliporium",
    default_path = "/io/github/cliporium/Cliporium"
)]
trait Cliporium {
    fn ping(&self) -> zbus::Result<String>;
    fn capture_text(&self, text: &str, source_app: &str) -> zbus::Result<String>;
    fn capture_image(&self, mime: &str, bytes: Vec<u8>, source_app: &str) -> zbus::Result<String>;
    fn search(&self, query: &str, limit: u32) -> zbus::Result<String>;
    fn recent(&self, limit: u32) -> zbus::Result<String>;
    fn get_blob(&self, id: &str) -> zbus::Result<Vec<u8>>;
    fn set_pinned(&self, id: &str, pinned: bool) -> zbus::Result<()>;
    fn delete(&self, id: &str) -> zbus::Result<()>;
}

pub async fn serve(data_dir: PathBuf) -> anyhow::Result<Connection> {
    let database = clip_core::database_path(&data_dir);
    let store = Store::open(&database)
        .with_context(|| format!("opening clipboard database at {}", database.display()))?;
    let service = CliporiumService::new(store);
    let connection = zbus::connection::Builder::session()
        .name(SERVICE_NAME)
        .serve_at(SERVICE_PATH, service)
        .build()
        .await
        .context("serving the Cliporium D-Bus interface")?;
    Ok(connection)
}

pub async fn run() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("cliporium_daemon=info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    let data_dir = match std::env::var_os("CLIPORIUM_DATA_DIR") {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => default_data_dir()?,
    };
    let _connection = serve(data_dir.clone()).await?;
    tracing::info!(
        service = SERVICE_NAME,
        data_dir = %data_dir.display(),
        "Cliporium daemon ready"
    );
    tokio::signal::ctrl_c().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dbus_roundtrip() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let _service = serve(temporary.path().to_path_buf())
            .await
            .expect("service");
        let client = zbus::connection::Builder::session()
            .build()
            .await
            .expect("client connection");
        let proxy = CliporiumProxy::builder(&client)
            .destination(SERVICE_NAME)
            .path(SERVICE_PATH)
            .build()
            .await
            .expect("proxy");

        assert_eq!(proxy.ping().await.expect("ping"), "pong");

        let id = proxy
            .capture_text("hello dbus roundtrip", "org.gnome.Terminal")
            .await
            .expect("capture");
        let search: serde_json::Value =
            serde_json::from_str(&proxy.search("roundtrip", 10).await.expect("search"))
                .expect("search json");
        let items = search.as_array().expect("search array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["text"], "hello dbus roundtrip");

        let image_bytes = b"\x89PNG\r\n\x1a\nphase-zero-image";
        let image_id = proxy
            .capture_image("image/png", image_bytes.to_vec(), "org.gnome.Screenshot")
            .await
            .expect("image capture");
        assert_eq!(proxy.get_blob(&image_id).await.expect("blob"), image_bytes);

        proxy.set_pinned(&id, true).await.expect("pin");
        let recent: serde_json::Value =
            serde_json::from_str(&proxy.recent(10).await.expect("recent")).expect("recent json");
        assert_eq!(recent[0]["pinned"], true);

        proxy.delete(&id).await.expect("delete");
        let remaining: serde_json::Value =
            serde_json::from_str(&proxy.recent(10).await.expect("recent")).expect("recent json");
        let remaining = remaining.as_array().expect("array");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0]["id"], image_id);

        proxy.delete(&image_id).await.expect("delete image");
        let empty: serde_json::Value =
            serde_json::from_str(&proxy.recent(10).await.expect("recent")).expect("recent json");
        assert!(empty.as_array().expect("array").is_empty());
    }
}
