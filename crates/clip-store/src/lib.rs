mod legacy;

use clip_core::{
    ClipItem, ItemKind, NewImageCapture, NewTextCapture, blob_absolute_path, blob_relative_path,
    blob_root, now_unix, sha256_hex, text_preview,
};
pub use legacy::{LegacyEntry, parse_registry};
use rusqlite::{Connection, OptionalExtension, Row, params};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const JPEG_SIGNATURE: &[u8] = &[0xFF, 0xD8, 0xFF];

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
"#;

const ITEM_COLUMNS: &str = "id, uuid, kind, text, preview, sha256, byte_size, created_at, pinned, source_app, blob_path, mime";

const QUALIFIED_ITEM_COLUMNS: &str = "items.id, items.uuid, items.kind, items.text, items.preview, \
    items.sha256, items.byte_size, items.created_at, items.pinned, items.source_app, \
    items.blob_path, items.mime";

pub const MAX_TEXT_BYTES: usize = 64 * 1024;
pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReconcileReport {
    pub removed_files: usize,
    pub removed_dirs: usize,
    pub kept_files: usize,
}

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
    #[error("unsupported schema version {found}; this build supports {supported}")]
    UnsupportedSchema { found: i64, supported: i64 },
    #[error("database failed quick_check: {0}")]
    CorruptDatabase(String),
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
            .filter(|parent| !parent.as_os_str().is_empty())
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        if data_dir != Path::new(".") {
            ensure_private_dir(&data_dir)?;
        }
        ensure_private_dir(&blob_root(&data_dir))?;
        create_private_database_file(path)?;
        set_private_file(path)?;

        let connection = Connection::open(path)?;
        Self::configure(&connection)?;
        let store = Self {
            connection,
            data_dir,
        };
        store.harden_database_files(path)?;
        let check = store.quick_check()?;
        if check != "ok" {
            return Err(StoreError::CorruptDatabase(check));
        }
        store.migrate()?;
        store.harden_database_files(path)?;
        store.reconcile_blobs()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let data_dir = std::env::temp_dir()
            .join("cliporium-tests")
            .join(uuid::Uuid::new_v4().to_string());
        ensure_private_dir(&data_dir)?;
        ensure_private_dir(&blob_root(&data_dir))?;
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
        let version: i64 = self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(StoreError::UnsupportedSchema {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
        if version < SCHEMA_VERSION {
            self.connection.execute_batch(SCHEMA)?;
            self.connection
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        }
        Ok(())
    }

    fn harden_database_files(&self, path: &Path) -> Result<()> {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let candidate = with_suffix(path, suffix);
            if candidate.exists() {
                set_private_file(&candidate)?;
            }
        }
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
        if capture.text.len() > MAX_TEXT_BYTES {
            return Err(StoreError::InvalidInput(format!(
                "text capture exceeds {MAX_TEXT_BYTES} bytes"
            )));
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
        if !matches!(capture.mime, "image/png" | "image/jpeg") {
            return Err(StoreError::InvalidInput(format!(
                "unsupported image mime type: {}",
                capture.mime
            )));
        }
        if capture.bytes.len() > MAX_IMAGE_BYTES {
            return Err(StoreError::InvalidInput(format!(
                "image capture exceeds {MAX_IMAGE_BYTES} bytes"
            )));
        }
        if capture.bytes.is_empty() {
            return Err(StoreError::InvalidInput(
                "image capture cannot be empty".to_string(),
            ));
        }
        if !image_matches_mime(capture.mime, capture.bytes) {
            return Err(StoreError::InvalidInput(format!(
                "image bytes do not match mime type {}",
                capture.mime
            )));
        }

        let sha256 = sha256_hex(capture.bytes);
        let relative = blob_relative_path(&sha256);
        let absolute = blob_absolute_path(&self.data_dir, &sha256);
        if !absolute.exists() {
            let root = blob_root(&self.data_dir);
            ensure_private_dir(&root)?;
            ensure_private_dir(&root.join("sha256"))?;
            let Some(parent) = absolute.parent() else {
                return Err(StoreError::Io(std::io::Error::other(
                    "blob path has no parent",
                )));
            };
            ensure_private_dir(parent)?;
            let temporary = absolute.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
            let write_result = (|| -> std::io::Result<()> {
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options.open(&temporary)?;
                file.write_all(capture.bytes)?;
                file.sync_all()?;
                Ok(())
            })();
            if let Err(error) = write_result {
                let _ = fs::remove_file(&temporary);
                return Err(error.into());
            }
            if let Err(error) = fs::rename(&temporary, &absolute) {
                let _ = fs::remove_file(&temporary);
                return Err(error.into());
            }
            sync_directory(parent)?;
        } else {
            set_private_file(&absolute)?;
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
        let path = blob_path.map(|relative| self.data_dir.join("blobs").join(relative));
        let mut trash = None;
        if let Some(path) = &path
            && path.exists()
        {
            let trash_path = path.with_extension(format!("delete-{}", uuid::Uuid::new_v4()));
            fs::rename(path, &trash_path)?;
            trash = Some(trash_path);
        }

        match self
            .connection
            .execute("DELETE FROM items WHERE uuid = ?1", [id])
        {
            Ok(0) => {
                restore_blob(trash.as_deref(), path.as_deref());
                Err(StoreError::NotFound(id.to_string()))
            }
            Ok(_) => {
                if let Some(trash_path) = trash.take() {
                    let _ = fs::remove_file(trash_path);
                }
                Ok(())
            }
            Err(error) => {
                restore_blob(trash.as_deref(), path.as_deref());
                Err(error.into())
            }
        }
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

    pub fn quick_check(&self) -> Result<String> {
        self.connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(StoreError::from)
    }

    pub fn reconcile_blobs(&self) -> Result<ReconcileReport> {
        let root = blob_root(&self.data_dir);
        if !root.exists() {
            return Ok(ReconcileReport::default());
        }
        let mut statement = self
            .connection
            .prepare("SELECT blob_path FROM items WHERE blob_path IS NOT NULL")?;
        let referenced = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<HashSet<String>>>()?;
        let referenced = referenced
            .into_iter()
            .map(PathBuf::from)
            .collect::<HashSet<_>>();
        let mut report = ReconcileReport::default();
        reconcile_directory(&root, &root, &referenced, &mut report)?;
        Ok(report)
    }
}

fn restore_blob(trash: Option<&Path>, path: Option<&Path>) {
    if let (Some(trash), Some(path)) = (trash, path) {
        let _ = fs::rename(trash, path);
    }
}

fn reconcile_directory(
    root: &Path,
    directory: &Path,
    referenced: &HashSet<PathBuf>,
    report: &mut ReconcileReport,
) -> Result<()> {
    let mut entries = fs::read_dir(directory)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            reconcile_directory(root, &path, referenced, report)?;
            if fs::read_dir(&path)?.next().is_none() {
                fs::remove_dir(&path)?;
                report.removed_dirs += 1;
            }
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map(Path::to_path_buf)
            .unwrap_or(path.clone());
        if referenced.contains(&relative) {
            report.kept_files += 1;
        } else {
            fs::remove_file(&path)?;
            report.removed_files += 1;
        }
    }
    Ok(())
}

fn image_matches_mime(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(PNG_SIGNATURE),
        "image/jpeg" => bytes.starts_with(JPEG_SIGNATURE),
        _ => false,
    }
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn create_private_database_file(path: &Path) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    match options.open(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn ensure_private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn set_private_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    Ok(())
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

    #[test]
    fn quick_check_reports_healthy_database() {
        let store = text_store();
        assert_eq!(store.quick_check().expect("quick check"), "ok");
    }

    #[test]
    fn open_rejects_newer_schema_version() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let data_dir = temporary.path().join("data");
        fs::create_dir_all(&data_dir).expect("data dir");
        let path = data_dir.join("cliporium.sqlite3");
        let connection = Connection::open(&path).expect("connection");
        connection
            .execute_batch("PRAGMA user_version = 2;")
            .expect("set version");
        drop(connection);

        let error = match Store::open(&path) {
            Ok(_) => panic!("newer schema must be rejected"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            StoreError::UnsupportedSchema {
                found: 2,
                supported: 1
            }
        ));
    }

    #[test]
    fn rejects_oversized_text() {
        let store = text_store();
        let text = "a".repeat(MAX_TEXT_BYTES + 1);
        let error = store
            .capture_text(NewTextCapture {
                text: &text,
                source_app: None,
            })
            .expect_err("oversized text must be rejected");
        assert!(matches!(error, StoreError::InvalidInput(_)));
        assert_eq!(store.count().expect("count"), 0);
    }

    #[test]
    fn rejects_oversized_image() {
        let store = text_store();
        let bytes = vec![0_u8; MAX_IMAGE_BYTES + 1];
        let error = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes: &bytes,
                source_app: None,
            })
            .expect_err("oversized image must be rejected");
        assert!(matches!(error, StoreError::InvalidInput(_)));
        assert_eq!(store.count().expect("count"), 0);
    }

    #[test]
    fn rejects_unsupported_image_mime() {
        let store = text_store();
        let bytes = b"\x89PNG\r\n\x1a\nnot-really-a-gif";
        let error = store
            .capture_image(NewImageCapture {
                mime: "image/gif",
                bytes,
                source_app: None,
            })
            .expect_err("unsupported mime must be rejected");
        assert!(matches!(error, StoreError::InvalidInput(_)));
        assert_eq!(store.count().expect("count"), 0);
    }

    #[test]
    fn rejects_image_bytes_that_do_not_match_mime() {
        let store = text_store();
        let bytes = b"not a png payload";
        let error = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes,
                source_app: None,
            })
            .expect_err("mismatched image bytes must be rejected");
        assert!(matches!(error, StoreError::InvalidInput(_)));
        assert_eq!(store.count().expect("count"), 0);
    }

    #[test]
    fn reconcile_removes_orphaned_files_but_keeps_referenced_blobs() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let store = Store::open(temporary.path().join("data/cliporium.sqlite3")).expect("store");
        let item = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes: b"\x89PNG\r\n\x1a\nreconcile-image",
                source_app: None,
            })
            .expect("image capture");
        let blob = store
            .data_dir()
            .join("blobs")
            .join(item.blob_path.as_ref().expect("blob path"));

        let orphan_dir = store.data_dir().join("blobs/sha256/zz");
        fs::create_dir_all(&orphan_dir).expect("orphan dir");
        let orphan = orphan_dir.join("orphan.bin");
        fs::write(&orphan, b"orphan").expect("orphan file");
        let temporary_blob = orphan_dir.join(".tmp-leftover");
        fs::write(&temporary_blob, b"leftover").expect("temporary file");

        let report = store.reconcile_blobs().expect("reconcile");
        assert!(!orphan.exists(), "orphaned blob must be removed");
        assert!(!temporary_blob.exists(), "temporary blob must be removed");
        assert!(blob.exists(), "referenced blob must be kept");
        assert_eq!(report.kept_files, 1);
        assert!(report.removed_files >= 2);
        assert!(
            !orphan_dir.exists(),
            "empty orphan directory must be removed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn file_store_uses_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        fn mode(path: &Path) -> u32 {
            fs::metadata(path).expect("metadata").permissions().mode() & 0o777
        }

        let temporary = tempfile::tempdir().expect("tempdir");
        let data_dir = temporary.path().join("data");
        let store = Store::open(data_dir.join("cliporium.sqlite3")).expect("store");
        let item = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes: b"\x89PNG\r\n\x1a\nprivate-image",
                source_app: None,
            })
            .expect("image capture");
        let blob = store
            .data_dir()
            .join("blobs")
            .join(item.blob_path.as_ref().expect("blob path"));

        assert_eq!(mode(store.data_dir()), 0o700);
        assert_eq!(mode(&data_dir.join("blobs")), 0o700);
        assert_eq!(mode(&data_dir.join("cliporium.sqlite3")), 0o600);
        assert_eq!(mode(blob.parent().expect("blob parent")), 0o700);
        assert_eq!(mode(&blob), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn delete_keeps_row_when_blob_removal_fails() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = tempfile::tempdir().expect("tempdir");
        let store = Store::open(temporary.path().join("data/cliporium.sqlite3")).expect("store");
        let item = store
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes: b"\x89PNG\r\n\x1a\ndelete-image",
                source_app: None,
            })
            .expect("image capture");
        let blob = store
            .data_dir()
            .join("blobs")
            .join(item.blob_path.as_ref().expect("blob path"));
        let parent = blob.parent().expect("blob parent");
        let original = fs::metadata(parent).expect("metadata").permissions().mode();

        fs::set_permissions(parent, fs::Permissions::from_mode(0o500))
            .expect("make blob directory read-only");
        let result = store.delete(&item.id);
        fs::set_permissions(parent, fs::Permissions::from_mode(original))
            .expect("restore blob directory permissions");

        assert!(
            result.is_err(),
            "delete must fail when the blob cannot move"
        );
        assert!(
            store.get(&item.id).expect("get").is_some(),
            "the row must survive a failed blob removal"
        );
    }
}
