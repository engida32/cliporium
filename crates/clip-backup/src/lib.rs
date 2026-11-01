use rusqlite::Connection;
use rusqlite::backup::Backup;
use std::fs;
use std::path::Path;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("backup failed integrity check: {0}")]
    Corrupt(String),
}

pub type Result<T> = std::result::Result<T, BackupError>;

pub fn backup_database(source: &Connection, destination: &Path) -> Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    let mut target = Connection::open(destination)?;
    let backup = Backup::new(source, &mut target)?;
    backup.run_to_completion(128, Duration::from_millis(0), None)?;
    drop(backup);
    target.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    drop(target);
    verify_database(destination)
}

pub fn verify_database(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(BackupError::Corrupt(result));
    }
    Ok(())
}

pub fn restore_database(backup: &Path, destination: &Path) -> Result<()> {
    verify_database(backup)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = destination.with_extension("restore-tmp");
    fs::copy(backup, &temporary)?;
    verify_database(&temporary)?;
    fs::rename(&temporary, destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clip_core::NewTextCapture;
    use clip_store::Store;

    #[test]
    fn backup_restore_preserves_rows_and_fts() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let source_path = temporary.path().join("source.sqlite3");
        let backup_path = temporary.path().join("backup.sqlite3");
        let restored_path = temporary.path().join("restored.sqlite3");

        let source = Store::open(&source_path).expect("source store");
        source
            .capture_text(NewTextCapture {
                text: "hello from the backup test",
                source_app: Some("test"),
            })
            .expect("capture");
        source
            .capture_text(NewTextCapture {
                text: "second clipboard item",
                source_app: Some("test"),
            })
            .expect("capture");

        backup_database(source.connection(), &backup_path).expect("backup");
        assert!(backup_path.exists());
        verify_database(&backup_path).expect("verify backup");

        let backup = Connection::open(&backup_path).expect("open backup");
        let count: i64 = backup
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 2);
        let matches: i64 = backup
            .query_row(
                "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH '\"backup\"'",
                [],
                |row| row.get(0),
            )
            .expect("fts");
        assert_eq!(matches, 1);

        restore_database(&backup_path, &restored_path).expect("restore");
        let restored = Store::open(&restored_path).expect("restored store");
        assert_eq!(restored.count().expect("count"), 2);
        assert_eq!(restored.integrity_check().expect("integrity"), "ok");
        assert_eq!(restored.search("clipboard", 10).expect("search").len(), 1);
    }
}
