use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::path::{Path, PathBuf};
use thiserror::Error;

pub const APP_ID: &str = "io.github.cliporium.Cliporium";
pub const OBJECT_PATH: &str = "/io/github/cliporium/Cliporium";
pub const APP_DIR: &str = "cliporium";

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("XDG directory is unavailable")]
    MissingHome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Text,
    Image,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "image" => Some(Self::Image),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipItem {
    pub id: String,
    pub kind: ItemKind,
    pub text: Option<String>,
    pub preview: String,
    pub sha256: String,
    pub byte_size: u64,
    pub created_at: i64,
    pub pinned: bool,
    pub source_app: Option<String>,
    pub blob_path: Option<String>,
    pub mime: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewTextCapture<'a> {
    pub text: &'a str,
    pub source_app: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct NewImageCapture<'a> {
    pub mime: &'a str,
    pub bytes: &'a [u8],
    pub source_app: Option<&'a str>,
}

pub fn home_dir() -> Result<PathBuf, CoreError> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or(CoreError::MissingHome)
}

fn xdg_dir(variable: &str, fallback: &str) -> Result<PathBuf, CoreError> {
    if let Some(value) = env::var_os(variable)
        && !value.is_empty()
    {
        return Ok(PathBuf::from(value).join(APP_DIR));
    }
    Ok(home_dir()?.join(fallback).join(APP_DIR))
}

pub fn data_dir() -> Result<PathBuf, CoreError> {
    xdg_dir("XDG_DATA_HOME", ".local/share")
}

pub fn config_dir() -> Result<PathBuf, CoreError> {
    xdg_dir("XDG_CONFIG_HOME", ".config")
}

pub fn state_dir() -> Result<PathBuf, CoreError> {
    xdg_dir("XDG_STATE_HOME", ".local/state")
}

pub fn database_path(data_dir: &Path) -> PathBuf {
    data_dir.join("cliporium.sqlite3")
}

pub fn blob_root(data_dir: &Path) -> PathBuf {
    data_dir.join("blobs")
}

pub fn blob_relative_path(sha256: &str) -> PathBuf {
    let prefix = sha256.get(..2).unwrap_or("00");
    Path::new("sha256").join(prefix).join(sha256)
}

pub fn blob_absolute_path(data_dir: &Path, sha256: &str) -> PathBuf {
    blob_root(data_dir).join(blob_relative_path(sha256))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

pub fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

pub fn text_preview(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = String::new();
    for character in collapsed.chars() {
        if preview.chars().count() >= 120 {
            preview.push('…');
            break;
        }
        preview.push(character);
    }
    preview
}
