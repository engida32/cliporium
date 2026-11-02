use clip_backup::verify_bundle;
use clip_core::{NewImageCapture, NewTextCapture};
use clip_store::Store;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_cliporium-backup"))
}

fn output_text(output: &Output) -> (String, String) {
    (
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

fn assert_success(output: &Output) {
    let (stdout, stderr) = output_text(output);
    assert!(
        output.status.success(),
        "command failed\nstdout: {stdout}\nstderr: {stderr}"
    );
}

fn seed(data_dir: &Path) -> (String, Vec<u8>) {
    fs::create_dir_all(data_dir).expect("create data dir");
    let store = Store::open(data_dir.join("cliporium.sqlite3")).expect("store");
    store
        .capture_text(NewTextCapture {
            text: "backup cli text",
            source_app: Some("org.example.Test"),
        })
        .expect("text capture");
    let image_bytes = b"\x89PNG\r\n\x1a\nbackup-cli-image".to_vec();
    let image = store
        .capture_image(NewImageCapture {
            mime: "image/png",
            bytes: &image_bytes,
            source_app: Some("org.example.Test"),
        })
        .expect("image capture");
    (image.id, image_bytes)
}

fn run<I, S>(args: I) -> Output
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    binary().args(args).output().expect("run cli")
}

fn data_arg(data_dir: &Path) -> PathBuf {
    data_dir.to_path_buf()
}

#[test]
fn create_verify_restore_round_trip() {
    let temporary = tempfile::tempdir().expect("tempdir");
    let data_dir = temporary.path().join("data");
    let (image_id, image_bytes) = seed(&data_dir);
    let bundle = temporary.path().join("bundle");

    let created = run([
        OsStr::new("create"),
        OsStr::new("--data-dir"),
        data_arg(&data_dir).as_os_str(),
        OsStr::new("--output"),
        bundle.as_os_str(),
    ]);
    assert_success(&created);
    let (stdout, _) = output_text(&created);
    assert!(stdout.contains("Backup created"));
    assert!(stdout.contains("Items: 2"));

    let verified = run([OsStr::new("verify"), bundle.as_os_str()]);
    assert_success(&verified);
    let (stdout, _) = output_text(&verified);
    assert!(stdout.contains("Backup OK"));
    assert!(stdout.contains("Items: 2"));

    let restored_dir = temporary.path().join("restored");
    let restored = run([
        OsStr::new("restore"),
        bundle.as_os_str(),
        OsStr::new("--data-dir"),
        data_arg(&restored_dir).as_os_str(),
    ]);
    assert_success(&restored);
    let (stdout, _) = output_text(&restored);
    assert!(stdout.contains("Restore complete"));

    let store = Store::open(restored_dir.join("cliporium.sqlite3")).expect("restored store");
    assert_eq!(store.count().expect("count"), 2);
    assert_eq!(
        store.read_blob(&image_id).expect("restored blob"),
        image_bytes
    );
}

#[test]
fn create_reports_a_missing_database() {
    let temporary = tempfile::tempdir().expect("tempdir");
    let data_dir = temporary.path().join("empty");
    fs::create_dir_all(&data_dir).expect("empty dir");
    let bundle = temporary.path().join("bundle");

    let output = run([
        OsStr::new("create"),
        OsStr::new("--data-dir"),
        data_arg(&data_dir).as_os_str(),
        OsStr::new("--output"),
        bundle.as_os_str(),
    ]);

    assert_eq!(output.status.code(), Some(1));
    let (_, stderr) = output_text(&output);
    assert!(stderr.contains("clipboard database not found"));
    assert!(!bundle.exists());
}

#[test]
fn restore_rejects_a_tampered_bundle_and_keeps_the_destination() {
    let temporary = tempfile::tempdir().expect("tempdir");
    let data_dir = temporary.path().join("data");
    seed(&data_dir);
    let bundle = temporary.path().join("bundle");
    let created = run([
        OsStr::new("create"),
        OsStr::new("--data-dir"),
        data_arg(&data_dir).as_os_str(),
        OsStr::new("--output"),
        bundle.as_os_str(),
    ]);
    assert_success(&created);

    let manifest = verify_bundle(&bundle).expect("manifest");
    let blob = bundle.join(&manifest.blobs[0].path);
    fs::write(&blob, b"tampered").expect("tamper");

    let destination = temporary.path().join("destination");
    let store = Store::open(destination.join("cliporium.sqlite3")).expect("destination store");
    store
        .capture_text(NewTextCapture {
            text: "keep this data",
            source_app: None,
        })
        .expect("seed destination");
    drop(store);

    let output = run([
        OsStr::new("restore"),
        bundle.as_os_str(),
        OsStr::new("--data-dir"),
        data_arg(&destination).as_os_str(),
    ]);

    assert_eq!(output.status.code(), Some(1));
    let (_, stderr) = output_text(&output);
    assert!(stderr.contains("checksum") || stderr.contains("invalid backup"));

    let store = Store::open(destination.join("cliporium.sqlite3")).expect("preserved store");
    assert_eq!(store.count().expect("count"), 1);
    assert_eq!(store.search("keep this data", 10).expect("search").len(), 1);
}

#[test]
fn unknown_command_explains_usage() {
    let output = run([OsStr::new("wat")]);

    assert_eq!(output.status.code(), Some(2));
    let (_, stderr) = output_text(&output);
    assert!(stderr.contains("Usage"));
}

#[test]
fn help_succeeds_with_usage() {
    let output = run([OsStr::new("--help")]);

    assert_success(&output);
    let (stdout, _) = output_text(&output);
    assert!(stdout.contains("Usage"));
}
