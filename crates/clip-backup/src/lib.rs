use clip_core::{blob_root, database_path, now_unix, sha256_hex};
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use thiserror::Error;

const MANIFEST: &str = "manifest.json";
const DATABASE: &str = "cliporium.sqlite3";
const BLOBS: &str = "blobs";

#[derive(Debug, Error)]
pub enum BackupError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("invalid backup: {0}")]
    Invalid(String),
    #[error("backup failed integrity check: {0}")]
    Corrupt(String),
}

pub type Result<T> = std::result::Result<T, BackupError>;

pub const BACKUP_FORMAT: &str = "cliporium-backup";
pub const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BackupFile {
    pub path: String,
    pub sha256: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BackupManifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: u32,
    pub created_at: i64,
    pub database: BackupFile,
    pub blobs: Vec<BackupFile>,
    pub item_count: u64,
}

pub fn backup_bundle(
    source: &Connection,
    source_data_dir: &Path,
    destination: &Path,
) -> Result<BackupManifest> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = temporary_sibling(destination, "backup-tmp")?;
    let manifest = match build_bundle(source, source_data_dir, &staging) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if let Err(error) = publish_dir(&staging, destination, None) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(manifest)
}

pub fn restore_bundle(backup: &Path, destination_data_dir: &Path) -> Result<BackupManifest> {
    let manifest = verify_bundle(backup)?;
    let parent = destination_data_dir
        .parent()
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = temporary_sibling(destination_data_dir, "restore-tmp")?;
    fs::create_dir_all(&staging)?;
    set_private_dir(&staging)?;

    let result = (|| {
        let source_database = database_path(backup);
        let target_database = database_path(&staging);
        fs::copy(&source_database, &target_database)?;
        set_private_file(&target_database)?;
        verify_file(&target_database, &manifest.database)?;
        verify_database(&target_database)?;

        for blob in &manifest.blobs {
            let relative = manifest_blob_relative(&blob.path)?;
            let source = backup.join(&blob.path);
            let target = blob_root(&staging).join(&relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
                set_private_dir(parent)?;
            }
            fs::copy(&source, &target)?;
            set_private_file(&target)?;
            verify_file(&target, blob)?;
        }

        sync_tree(&staging)?;
        verify_database(&target_database)?;
        remove_sidecars(&target_database)?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if let Err(error) = publish_dir(&staging, destination_data_dir, Some("pre-restore")) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(manifest)
}

pub fn verify_bundle(backup: &Path) -> Result<BackupManifest> {
    if !backup.is_dir() {
        return Err(BackupError::Invalid(format!(
            "backup is not a directory: {}",
            backup.display()
        )));
    }
    let manifest_path = backup.join(MANIFEST);
    let manifest: BackupManifest = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if manifest.format != BACKUP_FORMAT {
        return Err(BackupError::Invalid(format!(
            "unsupported backup format: {}",
            manifest.format
        )));
    }
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(BackupError::Invalid(format!(
            "unsupported backup format version: {}",
            manifest.format_version
        )));
    }
    if manifest.database.path != DATABASE {
        return Err(BackupError::Invalid(format!(
            "unexpected database path: {}",
            manifest.database.path
        )));
    }

    let database = database_path(backup);
    verify_file(&database, &manifest.database)?;
    verify_database(&database)?;

    let mut seen = HashSet::new();
    for blob in &manifest.blobs {
        let relative = manifest_blob_relative(&blob.path)?;
        if !seen.insert(relative) {
            return Err(BackupError::Invalid(format!(
                "duplicate blob in manifest: {}",
                blob.path
            )));
        }
        verify_file(&backup.join(&blob.path), blob)?;
    }

    let connection = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let item_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))?;
    if u64::try_from(item_count).ok() != Some(manifest.item_count) {
        return Err(BackupError::Invalid(format!(
            "manifest item count {} does not match database count {}",
            manifest.item_count, item_count
        )));
    }

    let mut statement =
        connection.prepare("SELECT blob_path FROM items WHERE blob_path IS NOT NULL")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut referenced = HashSet::new();
    for row in rows {
        referenced.insert(safe_relative(&row?)?);
    }
    if referenced != seen {
        return Err(BackupError::Invalid(
            "manifest blob list does not match database references".to_string(),
        ));
    }

    Ok(manifest)
}

fn build_bundle(
    source: &Connection,
    source_data_dir: &Path,
    staging: &Path,
) -> Result<BackupManifest> {
    fs::create_dir_all(staging)?;
    set_private_dir(staging)?;

    let snapshot_path = database_path(staging);
    {
        let mut target = Connection::open(&snapshot_path)?;
        target.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;")?;
        let backup = Backup::new(source, &mut target)?;
        backup.run_to_completion(128, Duration::from_millis(0), None)?;
        drop(backup);
        target.execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE);
             PRAGMA journal_mode = DELETE;",
        )?;
    }
    remove_sidecars(&snapshot_path)?;
    set_private_file(&snapshot_path)?;
    verify_database(&snapshot_path)?;

    let snapshot = Connection::open_with_flags(
        &snapshot_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let schema_version: i64 = snapshot.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let item_count: i64 = snapshot.query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))?;

    let mut statement = snapshot.prepare(
        "SELECT blob_path, sha256, byte_size FROM items
         WHERE blob_path IS NOT NULL
         ORDER BY blob_path",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;

    let mut blobs = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let (blob_path, expected_sha256, expected_size) = row?;
        let relative = safe_relative(&blob_path)?;
        if !seen.insert(relative.clone()) {
            continue;
        }

        let source_blob = blob_root(source_data_dir).join(&relative);
        let bytes = fs::read(&source_blob).map_err(|error| {
            BackupError::Invalid(format!("missing blob {}: {error}", source_blob.display()))
        })?;
        let actual_sha256 = sha256_hex(&bytes);
        if actual_sha256 != expected_sha256 {
            return Err(BackupError::Invalid(format!(
                "blob checksum mismatch for {}: expected {expected_sha256}, got {actual_sha256}",
                source_blob.display()
            )));
        }
        if expected_size < 0 || u64::try_from(expected_size).ok() != Some(bytes.len() as u64) {
            return Err(BackupError::Invalid(format!(
                "blob size mismatch for {}: expected {expected_size}, got {}",
                source_blob.display(),
                bytes.len()
            )));
        }

        let target_blob = blob_root(staging).join(&relative);
        if let Some(parent) = target_blob.parent() {
            fs::create_dir_all(parent)?;
            set_private_dir(parent)?;
        }
        fs::write(&target_blob, &bytes)?;
        set_private_file(&target_blob)?;
        blobs.push(BackupFile {
            path: format!("{BLOBS}/{}", relative.to_string_lossy()),
            sha256: expected_sha256,
            byte_size: bytes.len() as u64,
        });
    }

    drop(statement);
    drop(snapshot);

    let snapshot_bytes = fs::read(&snapshot_path)?;
    let manifest = BackupManifest {
        format: BACKUP_FORMAT.to_string(),
        format_version: BACKUP_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: u32::try_from(schema_version).map_err(|_| {
            BackupError::Invalid(format!("invalid schema version: {schema_version}"))
        })?,
        created_at: now_unix(),
        database: BackupFile {
            path: DATABASE.to_string(),
            sha256: sha256_hex(&snapshot_bytes),
            byte_size: snapshot_bytes.len() as u64,
        },
        blobs,
        item_count: u64::try_from(item_count)
            .map_err(|_| BackupError::Invalid(format!("invalid item count: {item_count}")))?,
    };
    let manifest_path = staging.join(MANIFEST);
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)?;
    set_private_file(&manifest_path)?;
    sync_tree(staging)?;
    Ok(manifest)
}

fn publish_dir(
    staging: &Path,
    destination: &Path,
    previous_tag: Option<&str>,
) -> Result<Option<PathBuf>> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    if !destination.exists() {
        fs::rename(staging, destination)?;
        sync_dir(parent)?;
        return Ok(None);
    }
    if !destination.is_dir() {
        return Err(BackupError::Invalid(format!(
            "destination exists and is not a directory: {}",
            destination.display()
        )));
    }

    let previous = temporary_sibling(destination, previous_tag.unwrap_or("previous"))?;
    fs::rename(destination, &previous)?;
    match fs::rename(staging, destination) {
        Ok(()) => {
            sync_dir(parent)?;
            if previous_tag.is_some() {
                Ok(Some(previous))
            } else {
                let _ = fs::remove_dir_all(&previous);
                Ok(None)
            }
        }
        Err(error) => {
            let _ = fs::rename(&previous, destination);
            Err(error.into())
        }
    }
}

fn temporary_sibling(destination: &Path, tag: &str) -> Result<PathBuf> {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            BackupError::Invalid(format!(
                "destination has no usable file name: {}",
                destination.display()
            ))
        })?;
    Ok(parent.join(format!(".{name}.{tag}-{}", uuid::Uuid::new_v4())))
}

fn manifest_blob_relative(path: &str) -> Result<PathBuf> {
    let path = safe_relative(path)?;
    let relative = path
        .strip_prefix(BLOBS)
        .map_err(|_| BackupError::Invalid(format!("blob path is outside {BLOBS}: {path:?}")))?
        .to_path_buf();
    if relative.as_os_str().is_empty() {
        return Err(BackupError::Invalid("blob path is empty".to_string()));
    }
    Ok(relative)
}

fn safe_relative(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(BackupError::Invalid(format!(
            "unsafe relative path: {value:?}"
        )));
    }
    Ok(path.to_path_buf())
}

fn verify_file(path: &Path, expected: &BackupFile) -> Result<()> {
    let metadata = fs::metadata(path)?;
    if metadata.len() != expected.byte_size {
        return Err(BackupError::Invalid(format!(
            "file size mismatch for {}: expected {}, got {}",
            path.display(),
            expected.byte_size,
            metadata.len()
        )));
    }
    let bytes = fs::read(path)?;
    let actual = sha256_hex(&bytes);
    if actual != expected.sha256 {
        return Err(BackupError::Invalid(format!(
            "file checksum mismatch for {}: expected {}, got {actual}",
            path.display(),
            expected.sha256
        )));
    }
    Ok(())
}

fn verify_database(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(BackupError::Corrupt(result));
    }
    Ok(())
}

fn remove_sidecars(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let sidecar = PathBuf::from(sidecar);
        if sidecar.exists() {
            fs::remove_file(sidecar)?;
        }
    }
    Ok(())
}

fn sync_tree(path: &Path) -> Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let child = entry.path();
        if child.is_dir() {
            sync_tree(&child)?;
        } else {
            sync_file(&child)?;
        }
    }
    sync_dir(path)
}

fn sync_file(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    Ok(())
}

fn set_private_dir(path: &Path) -> Result<()> {
    set_mode(path, 0o700)
}

fn set_private_file(path: &Path) -> Result<()> {
    set_mode(path, 0o600)
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clip_core::{ClipItem, NewImageCapture, NewTextCapture};
    use clip_store::Store;
    use std::fs;
    use tempfile::TempDir;

    fn fixture(temporary: &TempDir) -> (Store, ClipItem, Vec<u8>) {
        let data_dir = temporary.path().join("data");
        let source = Store::open(data_dir.join("cliporium.sqlite3")).expect("source store");
        source
            .capture_text(NewTextCapture {
                text: "hello from the backup test",
                source_app: Some("test"),
            })
            .expect("text capture");
        let bytes = b"\x89PNG\r\n\x1a\nbackup image payload".to_vec();
        let image = source
            .capture_image(NewImageCapture {
                mime: "image/png",
                bytes: &bytes,
                source_app: Some("test"),
            })
            .expect("image capture");
        (source, image, bytes)
    }

    #[test]
    fn backup_bundle_restores_rows_and_blobs() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, image, bytes) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        let manifest =
            backup_bundle(source.connection(), source.data_dir(), &bundle).expect("backup");

        assert_eq!(manifest.format, BACKUP_FORMAT);
        assert_eq!(manifest.format_version, BACKUP_FORMAT_VERSION);
        assert_eq!(manifest.item_count, 2);
        assert_eq!(manifest.blobs.len(), 1);
        assert!(bundle.join("manifest.json").is_file());
        assert!(bundle.join("cliporium.sqlite3").is_file());
        assert!(bundle.join(&manifest.blobs[0].path).is_file());

        let restored_data = temporary.path().join("restored");
        let restored_manifest = restore_bundle(&bundle, &restored_data).expect("restore bundle");
        assert_eq!(restored_manifest.item_count, 2);

        let restored = Store::open(restored_data.join("cliporium.sqlite3")).expect("restored");
        assert_eq!(restored.count().expect("count"), 2);
        assert_eq!(restored.read_blob(&image.id).expect("blob"), bytes);
        assert_eq!(restored.search("backup", 10).expect("search").len(), 1);
    }

    #[test]
    fn failed_backup_keeps_the_previous_bundle() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, image, _) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        backup_bundle(source.connection(), source.data_dir(), &bundle).expect("first backup");
        let original_manifest = fs::read(bundle.join("manifest.json")).expect("manifest");

        let blob_path = image.blob_path.expect("image blob path");
        fs::remove_file(source.data_dir().join("blobs").join(blob_path)).expect("remove blob");

        let result = backup_bundle(source.connection(), source.data_dir(), &bundle);
        assert!(result.is_err(), "backup should fail when a blob is missing");
        assert_eq!(
            fs::read(bundle.join("manifest.json")).expect("manifest"),
            original_manifest,
            "the previous backup must not be replaced by a failed backup"
        );
        verify_bundle(&bundle).expect("previous backup still verifies");
    }

    #[test]
    fn restore_rejects_a_tampered_blob_and_keeps_the_destination() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, _, _) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        let manifest =
            backup_bundle(source.connection(), source.data_dir(), &bundle).expect("backup");
        let destination = temporary.path().join("restored");
        let existing = Store::open(destination.join("cliporium.sqlite3")).expect("existing");
        existing
            .capture_text(NewTextCapture {
                text: "keep this history",
                source_app: None,
            })
            .expect("existing capture");
        drop(existing);

        fs::write(bundle.join(&manifest.blobs[0].path), b"tampered").expect("tamper blob");
        let result = restore_bundle(&bundle, &destination);
        assert!(result.is_err(), "restore should reject a tampered blob");

        let after = Store::open(destination.join("cliporium.sqlite3")).expect("after");
        assert_eq!(
            after.search("keep this history", 10).expect("search").len(),
            1
        );
    }

    #[test]
    fn restore_replaces_the_active_directory_and_keeps_a_pre_restore_copy() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, _, _) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        backup_bundle(source.connection(), source.data_dir(), &bundle).expect("backup");

        let destination = temporary.path().join("restored");
        fs::create_dir_all(&destination).expect("destination");
        fs::write(destination.join("old.txt"), b"old data").expect("old file");
        fs::write(destination.join("cliporium.sqlite3-wal"), b"stale wal").expect("wal");
        fs::write(destination.join("cliporium.sqlite3-shm"), b"stale shm").expect("shm");

        restore_bundle(&bundle, &destination).expect("restore");
        assert!(!destination.join("old.txt").exists());
        assert!(!destination.join("cliporium.sqlite3-wal").exists());
        assert!(!destination.join("cliporium.sqlite3-shm").exists());

        let pre_restore = fs::read_dir(temporary.path())
            .expect("read temp")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".restored.pre-restore-"))
            })
            .expect("pre-restore snapshot");
        assert_eq!(
            fs::read(pre_restore.join("old.txt")).expect("old data"),
            b"old data"
        );
        assert!(pre_restore.join("cliporium.sqlite3-wal").exists());

        let restored = Store::open(destination.join("cliporium.sqlite3")).expect("restored");
        assert_eq!(restored.count().expect("count"), 2);
    }

    #[test]
    fn verify_bundle_detects_a_tampered_database() {
        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, _, _) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        backup_bundle(source.connection(), source.data_dir(), &bundle).expect("backup");
        fs::write(bundle.join("cliporium.sqlite3"), b"not a database").expect("tamper db");
        assert!(verify_bundle(&bundle).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn backup_and_restore_files_are_private() {
        use std::os::unix::fs::PermissionsExt;

        fn mode(path: &Path) -> u32 {
            fs::metadata(path).expect("metadata").permissions().mode() & 0o777
        }

        let temporary = tempfile::tempdir().expect("tempdir");
        let (source, _, _) = fixture(&temporary);
        let bundle = temporary.path().join("backup");
        let manifest =
            backup_bundle(source.connection(), source.data_dir(), &bundle).expect("backup");
        assert_eq!(mode(&bundle), 0o700);
        assert_eq!(mode(&bundle.join("cliporium.sqlite3")), 0o600);
        assert_eq!(mode(&bundle.join("manifest.json")), 0o600);
        assert_eq!(mode(&bundle.join(&manifest.blobs[0].path)), 0o600);

        let restored_data = temporary.path().join("restored");
        restore_bundle(&bundle, &restored_data).expect("restore");
        assert_eq!(mode(&restored_data), 0o700);
        assert_eq!(mode(&restored_data.join("cliporium.sqlite3")), 0o600);
        assert_eq!(mode(&restored_data.join(&manifest.blobs[0].path)), 0o600);
    }
}
