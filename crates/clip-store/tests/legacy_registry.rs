use clip_store::{Store, parse_registry};

const FIXTURE: &str = include_str!("fixtures/legacy-registry.json");

#[test]
fn legacy_registry_fixture_imports_text_and_pins_favorites() {
    let entries = parse_registry(FIXTURE).expect("fixture parses");
    assert_eq!(entries.len(), 4);

    let store = Store::open_in_memory().expect("store opens");
    let imported = store.import_legacy_text(&entries).expect("import works");
    assert_eq!(imported, 2);

    let recent = store.recent(10).expect("recent works");
    assert_eq!(recent.len(), 2);
    let pinned = recent
        .iter()
        .find(|item| item.text.as_deref() == Some("first legacy item"))
        .expect("favorite imported");
    assert!(pinned.pinned);
    assert_eq!(pinned.source_app.as_deref(), Some("clipboard-indicator"));

    assert_eq!(store.search("legacy", 10).expect("search works").len(), 2);
}
