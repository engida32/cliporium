use clip_backup::{BackupManifest, backup_bundle, restore_bundle, verify_bundle};
use clip_core::{data_dir, database_path};
use rusqlite::{Connection, OpenFlags};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "\
Usage:
  cliporium-backup create --data-dir <DIR> --output <BUNDLE>
  cliporium-backup verify <BUNDLE>
  cliporium-backup restore <BUNDLE> --data-dir <DIR>

Commands:
  create   Create a verified backup bundle with the database and image blobs.
  verify   Verify a backup bundle without changing anything.
  restore  Restore a bundle. Stop any running Cliporium daemon first.

Options:
  --data-dir <DIR>   Data directory. Defaults to the Cliporium data directory.
  --output <BUNDLE>  Destination directory for a new backup.
  -h, --help         Show this help.
";

enum Command {
    Help,
    Create { data_dir: PathBuf, output: PathBuf },
    Verify { bundle: PathBuf },
    Restore { bundle: PathBuf, data_dir: PathBuf },
}

enum CliError {
    Usage(String),
    Runtime(String),
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(CliError::Usage(message)) => {
            eprintln!("error: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Err(CliError::Runtime(message)) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), CliError> {
    match parse(std::env::args_os().skip(1))? {
        Command::Help => {
            println!("{USAGE}");
            Ok(())
        }
        Command::Create { data_dir, output } => create(&data_dir, &output),
        Command::Verify { bundle } => verify(&bundle),
        Command::Restore { bundle, data_dir } => restore(&bundle, &data_dir),
    }
}

fn parse(args: impl Iterator<Item = OsString>) -> Result<Command, CliError> {
    let mut args = args;
    let command = args
        .next()
        .ok_or_else(|| CliError::Usage("missing command".to_string()))?;

    if is_help(&command) {
        return Ok(Command::Help);
    }

    match command.to_string_lossy().as_ref() {
        "create" => parse_create(args),
        "verify" => parse_verify(args),
        "restore" => parse_restore(args),
        other => Err(CliError::Usage(format!("unknown command: {other}"))),
    }
}

fn parse_create(mut args: impl Iterator<Item = OsString>) -> Result<Command, CliError> {
    let mut data_dir = None;
    let mut output = None;
    while let Some(arg) = args.next() {
        if is_help(&arg) {
            return Ok(Command::Help);
        }
        if arg == OsStr::new("--data-dir") {
            data_dir = Some(take_path(&mut args, "--data-dir")?);
        } else if arg == OsStr::new("--output") {
            output = Some(take_path(&mut args, "--output")?);
        } else {
            return Err(unknown_argument(&arg));
        }
    }
    Ok(Command::Create {
        data_dir: data_dir.unwrap_or(default_data_dir()?),
        output: output.ok_or_else(|| CliError::Usage("--output is required".to_string()))?,
    })
}

fn parse_verify(args: impl Iterator<Item = OsString>) -> Result<Command, CliError> {
    let mut bundle = None;
    for arg in args {
        if is_help(&arg) {
            return Ok(Command::Help);
        }
        if arg.to_string_lossy().starts_with('-') {
            return Err(unknown_argument(&arg));
        }
        if bundle.replace(PathBuf::from(&arg)).is_some() {
            return Err(CliError::Usage(format!(
                "unexpected argument: {}",
                arg.to_string_lossy()
            )));
        }
    }
    Ok(Command::Verify {
        bundle: bundle
            .ok_or_else(|| CliError::Usage("verify requires a backup bundle path".to_string()))?,
    })
}

fn parse_restore(mut args: impl Iterator<Item = OsString>) -> Result<Command, CliError> {
    let mut bundle = None;
    let mut data_dir = None;
    while let Some(arg) = args.next() {
        if is_help(&arg) {
            return Ok(Command::Help);
        }
        if arg == OsStr::new("--data-dir") {
            data_dir = Some(take_path(&mut args, "--data-dir")?);
        } else if arg.to_string_lossy().starts_with('-') {
            return Err(unknown_argument(&arg));
        } else if bundle.replace(PathBuf::from(&arg)).is_some() {
            return Err(CliError::Usage(format!(
                "unexpected argument: {}",
                arg.to_string_lossy()
            )));
        }
    }
    Ok(Command::Restore {
        bundle: bundle
            .ok_or_else(|| CliError::Usage("restore requires a backup bundle path".to_string()))?,
        data_dir: data_dir.unwrap_or(default_data_dir()?),
    })
}

fn is_help(value: &OsStr) -> bool {
    value == OsStr::new("-h") || value == OsStr::new("--help")
}

fn take_path(args: &mut impl Iterator<Item = OsString>, option: &str) -> Result<PathBuf, CliError> {
    args.next()
        .map(PathBuf::from)
        .ok_or_else(|| CliError::Usage(format!("{option} requires a path")))
}

fn unknown_argument(arg: &OsStr) -> CliError {
    CliError::Usage(format!("unknown argument: {}", arg.to_string_lossy()))
}

fn default_data_dir() -> Result<PathBuf, CliError> {
    data_dir().map_err(|error| CliError::Runtime(format!("cannot find data directory: {error}")))
}

fn create(data_dir: &Path, output: &Path) -> Result<(), CliError> {
    let database = database_path(data_dir);
    if !database.is_file() {
        return Err(CliError::Runtime(format!(
            "clipboard database not found: {}",
            database.display()
        )));
    }
    let connection = Connection::open_with_flags(
        &database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| CliError::Runtime(format!("cannot open {}: {error}", database.display())))?;
    let manifest = backup_bundle(&connection, data_dir, output)
        .map_err(|error| CliError::Runtime(format!("backup failed: {error}")))?;
    println!("Backup created: {}", output.display());
    print_manifest(&manifest);
    Ok(())
}

fn verify(bundle: &Path) -> Result<(), CliError> {
    let manifest = verify_bundle(bundle)
        .map_err(|error| CliError::Runtime(format!("verification failed: {error}")))?;
    println!("Backup OK: {}", bundle.display());
    print_manifest(&manifest);
    Ok(())
}

fn restore(bundle: &Path, data_dir: &Path) -> Result<(), CliError> {
    let existed = data_dir.exists();
    let manifest = restore_bundle(bundle, data_dir)
        .map_err(|error| CliError::Runtime(format!("restore failed: {error}")))?;
    println!("Restore complete: {}", data_dir.display());
    print_manifest(&manifest);
    if existed {
        println!("Previous data was kept in a sibling pre-restore directory.");
    }
    Ok(())
}

fn print_manifest(manifest: &BackupManifest) {
    println!("Format: {} v{}", manifest.format, manifest.format_version);
    println!("App version: {}", manifest.app_version);
    println!("Schema: v{}", manifest.schema_version);
    println!("Items: {}", manifest.item_count);
    println!("Blobs: {}", manifest.blobs.len());
    println!("Created (unix): {}", manifest.created_at);
}
