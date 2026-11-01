use clip_core::{
    ClipItem, ItemKind, NewImageCapture, NewTextCapture, blob_absolute_path, blob_relative_path,
    now_unix, sha256_hex, text_preview,
};
use rusqlite::{Connection, OptionalExtension, Row, params};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY,
    uuid        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL CHECK (kind IN ('text', 'image')),
    text        TEXT,
    preview     TEXT NOT NULL,
    sha256      TEXT NOT NULL UNIQUE,
    byte_size   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    source_app  TEXT,
    blob_path   TEXT,
    mime        TEXT
);

CREATE INDEX IF NOT EXISTS items_created_at ON items (created_at DESC);
CREATE INDEX IF NOT EXISTS items_pinned ON items (pinned, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    text,
    content = 'items',
    content_rowid = 'id',
    tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE OF text ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO items_fts (rowid, text) VALUES (new.id, new.text);
END;

PRAGMA user_version = 1;
"#;

const ITEM_COLUMNS: &str = "id, uuid, kind, text, preview, sha256, byte_size, created_at, pinned, source_app, blob_path, mime";

const QUALIFIED_ITEM_COLUMNS: &str = "items.id, items.uuid, items.kind, items.text, items.preview, \
    items.sha256, items.byte_size, items.created_at, items.pinned, items.source_app, \
    items.blob_path, items.mime";

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid capture: {0}")]
    InvalidInput(String),
    #[error("clipboard item not found: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct Store {
    connection: Connection,
    data_dir: PathBuf,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let data_dir = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        fs::create_dir_all(clip_core::blob_root(&data_dir))?;
        let connection = Connection::open(path)?;
        Self::configure(&connection)?;
        let store = Self {
            connection,
            data_dir,
        };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let data_dir = std::env::temp_dir()
            .join("cliporium-tests")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(clip_core::blob_root(&data_dir))?;
        let connection = Connection::open_in_memory()?;
        Self::configure(&connection)?;
        let store = Self {
            connection,
            data_dir,
        };
        store.migrate()?;
        Ok(store)
    }

    fn configure(connection: &Connection) -> Result<()> {
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA synchronous = FULL;
             PRAGMA journal_mode = WAL;",
        )?;
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(SCHEMA)?;
        Ok(())
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn capture_text(&self, capture: NewTextCapture<'_>) -> Result<ClipItem> {
        if capture.text.trim().is_empty() {
            return Err(StoreError::InvalidInput(
                "text capture cannot be empty".to_string(),
            ));
        }
        let sha256 = sha256_hex(capture.text.as_bytes());
        let preview = text_preview(capture.text);
        let byte_size = i64::try_from(capture.text.len()).unwrap_or(i64::MAX);
        let id = self.insert_item(
            ItemKind::Text,
            Some(capture.text),
            &preview,
            &sha256,
            byte_size,
            capture.source_app,
            None,
            None,
        )?;
        self.get(&id)?
            .ok_or_else(|| StoreError::NotFound(id.clone()))
    }

    pub fn capture_image(&self, capture: NewImageCapture<'_>) -> Result<ClipItem> {
        if !capture.mime.starts_with("image/") {
            return Err(StoreError::InvalidInput(format!(
                "unsupported image mime type: {}",
                capture.mime
            )));
        }
        if capture.bytes.is_empty() {
            return Err(StoreError::InvalidInput(
                "image capture cannot be empty".to_string(),
            ));
        }

        let sha256 = sha256_hex(capture.bytes);
        let relative = blob_relative_path(&sha256);
        let absolute = blob_absolute_path(&self.data_dir, &sha256);
        if !absolute.exists() {
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)?;
            }
            let temporary = absolute.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
            fs::write(&temporary, capture.bytes)?;
            fs::rename(&temporary, &absolute)?;
        }

        let preview = format!("{} · {} bytes", capture.mime, capture.bytes.len());
        let byte_size = i64::try_from(capture.bytes.len()).unwrap_or(i64::MAX);
        let blob_path = relative.to_string_lossy().to_string();
        let id = self.insert_item(
            ItemKind::Image,
            None,
            &preview,
            &sha256,
            byte_size,
            capture.source_app,
            Some(&blob_path),
            Some(capture.mime),
        )?;
        self.get(&id)?
            .ok_or_else(|| StoreError::NotFound(id.clone()))
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_item(
        &self,
        kind: ItemKind,
        text: Option<&str>,
        preview: &str,
        sha256: &str,
        byte_size: i64,
        source_app: Option<&str>,
        blob_path: Option<&str>,
        mime: Option<&str>,
    ) -> Result<String> {
        let created_at = now_unix();
        let new_uuid = uuid::Uuid::new_v4().to_string();
        let id = self.connection.query_row(
            "INSERT INTO items (uuid, kind, text, preview, sha256, byte_size, created_at, source_app, blob_path, mime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(sha256) DO UPDATE SET
                 created_at = excluded.created_at,
                 source_app = COALESCE(excluded.source_app, items.source_app)
             RETURNING uuid",
            params![
                new_uuid,
                kind.as_str(),
                text,
                preview,
                sha256,
                byte_size,
                created_at,
                source_app,
                blob_path,
                mime
            ],
            |row| row.get::<_, String>(0),
        )?;
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<Option<ClipItem>> {
        let mut statement = self
            .connection
            .prepare(&format!("SELECT {ITEM_COLUMNS} FROM items WHERE uuid = ?1"))?;
        let item = statement.query_row([id], row_to_item).optional()?;
        Ok(item)
    }

    pub fn recent(&self, limit: u32) -> Result<Vec<ClipItem>> {
        let limit = i64::from(limit.clamp(1, 500));
        let mut statement = self.connection.prepare(&format!(
            "SELECT {ITEM_COLUMNS} FROM items
             ORDER BY pinned DESC, created_at DESC
             LIMIT ?1"
        ))?;
        let rows = statement.query_map([limit], row_to_item)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(StoreError::from)
    }

    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<ClipItem>> {
        let query = query.trim();
        if query.is_empty() {
            return self.recent(limit);
        }
        let limit = i64::from(limit.clamp(1, 500));
        if query.chars().count() >= 3 {
            let match_query = format!("\"{}\"", query.replace('"', "\"\""));
            let mut statement = self.connection.prepare(&format!(
                "SELECT {QUALIFIED_ITEM_COLUMNS} FROM items
                 JOIN items_fts ON items_fts.rowid = items.id
                 WHERE items_fts MATCH ?1
                 ORDER BY items.pinned DESC, items.created_at DESC
                 LIMIT ?2"
            ))?;
            let rows = statement.query_map(params![match_query, limit], row_to_item)?;
            return rows
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(StoreError::from);
        }
        let mut statement = self.connection.prepare(&format!(
            "SELECT {ITEM_COLUMNS} FROM items
             WHERE instr(lower(COALESCE(text, '')), lower(?1)) > 0
                OR instr(lower(preview), lower(?1)) > 0
             ORDER BY pinned DESC, created_at DESC
             LIMIT ?2"
        ))?;
        let rows = statement.query_map(params![query, limit], row_to_item)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(StoreError::from)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        let changed = self.connection.execute(
            "UPDATE items SET pinned = ?1 WHERE uuid = ?2",
            params![if pinned { 1_i64 } else { 0_i64 }, id],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let blob_path = self
            .connection
            .query_row("SELECT blob_path FROM items WHERE uuid = ?1", [id], |row| {
                row.get::<_, Option<String>>(0)
            })
            .optional()?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        self.connection
            .execute("DELETE FROM items WHERE uuid = ?1", [id])?;
        if let Some(relative) = blob_path {
            let path = self.data_dir.join("blobs").join(relative);
            if path.exists() {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    pub fn read_blob(&self, id: &str) -> Result<Vec<u8>> {
        let relative = self
            .connection
            .query_row("SELECT blob_path FROM items WHERE uuid = ?1", [id], |row| {
                row.get::<_, Option<String>>(0)
            })
            .optional()?
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?
            .ok_or_else(|| StoreError::InvalidInput(format!("item {id} has no blob")))?;
        let path = self.data_dir.join("blobs").join(relative);
        fs::read(path).map_err(StoreError::from)
    }

    pub fn count(&self) -> Result<i64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .map_err(StoreError::from)
    }

    pub fn integrity_check(&self) -> Result<String> {
        self.connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(StoreError::from)
    }
}

fn row_to_item(row: &Row<'_>) -> rusqlite::Result<ClipItem> {
    let kind: String = row.get(2)?;
    Ok(ClipItem {
        id: row.get(1)?,
        kind: ItemKind::parse(&kind).unwrap_or(ItemKind::Text),
        text: row.get(3)?,
        preview: row.get(4)?,
        sha256: row.get(5)?,
        byte_size: u64::try_from(row.get::<_, i64>(6)?).unwrap_or_default(),
        created_at: row.get(7)?,
        pinned: row.get::<_, i64>(8)? != 0,
        source_app: row.get(9)?,
        blob_path: row.get(10)?,
        mime: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_store() -> Store {
        Store::open_in_memory().expect("in-memory store")
    }

    #[test]
    fn captures_and_deduplicates_text() {
        let store = text_store();
        let first = store
            .capture_text(NewTextCapture {
                text: "hello clipboard",
                source_app: Some("org.gnome.Terminal"),
            })
            .expect("capture");
        let second = store
            .capture_text(NewTextCapture {
                text: "hello clipboard",
                source_app: None,
            })
            .expect("recapture");
        assert_eq!(first.id, second.id);
        assert_eq!(store.count().expect("count"), 1);
    }

    #[test]
    fn trigram_search_finds_inside_words() {
        let store = text_store();
        store
            .capture_text(NewTextCapture {
                text: "The quick brown fox jumps over the lazy dog",
                source_app: None,
            })
            .expect("capture");
        store
            .capture_text(NewTextCapture {
                text: "unrelated clipboard entry",
                source_app: None,
            })
            .expect("capture");

        let results = store.search("brown", 10).expect("search");
        assert_eq!(results.len(), 1);
        assert!(results[0].text.as_deref().unwrap().contains("brown"));

        let partial = store.search("rown", 10).expect("partial search");
        assert_eq!(partial.len(), 1);
    }

    #[test]
    fn short_query_uses_like_fallback() {
        let store = text_store();
        store
            .capture_text(NewTextCapture {
                text: "abc",
                source_app: None,
            })
            .expect("capture");
        assert_eq!(store.search("bc", 10).expect("search").len(), 1);
    }

    #[test]
    fn pins_sort_before_newer_items() {
        let store = text_store();
        let older = store
            .capture_text(NewTextCapture {
                text: "older pinned",
                source_app: None,
            })
            .expect("capture");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        store
            .capture_text(NewTextCapture {
                text: "newer unpinned",
                source_app: None,
            })
            .expect("capture");
        store.set_pinned(&older.id, true).expect("pin");
        let items = store.recent(10).expect("recent");
        assert_eq!(items[0].id, older.id);
    }

    #[test]
    fn captures_image_with_hash_and_blob() {
        let store = text_store();
        let bytes = b"\x89PNG\r\n\x1a\nfake image payload";
        let item = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes,
                source_app: Some("org.gnome.Screenshot"),
            })
            .expect("image capture");
        assert_eq!(item.kind, ItemKind::Image);
        assert_eq!(item.sha256, sha256_hex(bytes));
        assert_eq!(item.byte_size, bytes.len() as u64);
        let blob_path = item.blob_path.expect("blob path");
        let absolute = store.data_dir().join("blobs").join(blob_path);
        assert_eq!(fs::read(absolute).expect("blob"), bytes);
        assert_eq!(store.count().expect("count"), 1);
    }

    #[test]
    fn integrity_check_passes() {
        let store = text_store();
        assert_eq!(store.integrity_check().expect("integrity"), "ok");
    }
}
