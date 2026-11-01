use crate::{Result, Store};
use clip_core::NewTextCapture;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct LegacyEntry {
    #[serde(default)]
    pub favorite: bool,
    #[serde(default = "default_mimetype")]
    pub mimetype: String,
    pub contents: String,
    #[serde(default)]
    pub tag: Option<String>,
}

fn default_mimetype() -> String {
    "text/plain;charset=utf-8".to_string()
}

pub fn parse_registry(json: &str) -> std::result::Result<Vec<LegacyEntry>, serde_json::Error> {
    serde_json::from_str(json)
}

fn is_text_mimetype(mimetype: &str) -> bool {
    mimetype.starts_with("text/") || mimetype == "STRING" || mimetype == "UTF8_STRING"
}

impl Store {
    pub fn import_legacy_text(&self, entries: &[LegacyEntry]) -> Result<usize> {
        let mut imported = 0;
        for entry in entries {
            if !is_text_mimetype(&entry.mimetype) || entry.contents.trim().is_empty() {
                continue;
            }
            let item = self.capture_text(NewTextCapture {
                text: &entry.contents,
                source_app: Some("clipboard-indicator"),
            })?;
            if entry.favorite {
                self.set_pinned(&item.id, true)?;
            }
            imported += 1;
        }
        Ok(imported)
    }
}
