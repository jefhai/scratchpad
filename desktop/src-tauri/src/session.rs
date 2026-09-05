//! Local session storage. Renderer payloads are bounded and validated before any write.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_WINDOWS: usize = 32;
pub const MAX_WORKSPACE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CHARS: usize = 8 * 1024 * 1024;
// The renderer budgets content, grid arrays and dimensions. This second,
// structural pass also visits metadata, so allow bounded structural headroom.
const METADATA_CHARACTERS: usize = 64 * 1024;
// Selection index arrays are not in the renderer's content budget; all 128 tabs
// can add at most 1,408,000 indices plus bounded history/metadata containers.
const METADATA_NODES: usize = 2_000_000;
const MAX_TEXT: usize = 4 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_990;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Default for Bounds {
    fn default() -> Self {
        Self {
            x: 80.0,
            y: 80.0,
            width: 1100.0,
            height: 800.0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowMetadata {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub bounds: Bounds,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub full_screen: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u8,
    pub windows: Vec<WindowMetadata>,
    pub focused_id: Option<String>,
}
impl Default for Manifest {
    fn default() -> Self {
        Self {
            version: 1,
            windows: Vec::new(),
            focused_id: None,
        }
    }
}
pub fn valid_id(id: &str) -> bool {
    id.strip_prefix("scratchpad-")
        .and_then(|part| Uuid::parse_str(part).ok())
        .is_some()
}
pub fn normalize_name(name: &str) -> Result<String, String> {
    let clean: String = name
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    let clean = clean.trim();
    if clean.is_empty() || clean.encode_utf16().count() > 80 {
        return Err("Use a window name between 1 and 80 characters.".into());
    }
    Ok(clean.to_owned())
}
fn bad() -> String {
    "The workspace format is invalid or exceeds the desktop session limits.".into()
}
fn integer(value: &Value, maximum: u64) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|number| *number <= maximum)
        .ok_or_else(bad)
}
fn text(value: &Value, maximum: usize) -> Result<(), String> {
    match value.as_str() {
        Some(value) if value.encode_utf16().count() <= maximum => Ok(()),
        _ => Err(bad()),
    }
}
fn coordinate(value: &Value) -> Result<(), String> {
    integer(&value["row"], MAX_SAFE_INTEGER)?;
    integer(&value["column"], MAX_SAFE_INTEGER)?;
    Ok(())
}
fn sheet(value: &Value) -> Result<(usize, usize), String> {
    let rows = value["grid"].as_array().ok_or_else(bad)?;
    if rows.is_empty() || rows.len() > 10_000 {
        return Err(bad());
    }
    let width = rows[0].as_array().ok_or_else(bad)?.len();
    if width == 0 || width > 1_000 || width * rows.len() > 50_000 {
        return Err(bad());
    }
    for row in rows {
        let cells = row.as_array().ok_or_else(bad)?;
        if cells.len() != width {
            return Err(bad());
        }
        for cell in cells {
            text(cell, MAX_TEXT)?;
        }
    }
    for (key, length, min, max) in [
        ("columnWidths", width, 56, 640),
        ("rowHeights", rows.len(), 24, 240),
    ] {
        if let Some(dimensions) = value.get(key) {
            let values = dimensions.as_array().ok_or_else(bad)?;
            if values.len() != length {
                return Err(bad());
            }
            for dimension in values {
                if !dimension.is_null() && integer(dimension, max)? < min {
                    return Err(bad());
                }
            }
        }
    }
    Ok((rows.len(), width))
}
fn value_for_kind(value: &Value, kind: &str) -> Result<(), String> {
    if kind == "text" {
        text(value, MAX_TEXT)
    } else {
        sheet(value).map(|_| ())
    }
}
fn budget(
    value: &Value,
    depth: usize,
    nodes: &mut usize,
    characters: &mut usize,
) -> Result<(), String> {
    *nodes += 1;
    if depth > 24 || *nodes > 2_000_000 + METADATA_NODES {
        return Err(bad());
    }
    match value {
        Value::String(string) => *characters += string.encode_utf16().count(),
        Value::Array(values) => {
            for child in values {
                budget(child, depth + 1, nodes, characters)?;
            }
        }
        Value::Object(values) => {
            for (key, child) in values {
                // Structural field names do not consume the renderer's content budget.
                // Still bound unknown keys individually; the serialized byte cap is independent.
                if key.len() > 256 {
                    return Err(bad());
                }
                budget(child, depth + 1, nodes, characters)?;
            }
        }
        _ => (),
    }
    if *characters > MAX_CHARS + METADATA_CHARACTERS {
        return Err(bad());
    }
    Ok(())
}
pub fn validate_workspace(value: Value) -> Result<Value, String> {
    let (mut nodes, mut characters) = (0, 0);
    budget(&value, 0, &mut nodes, &mut characters)?;
    if value["version"].as_u64() != Some(1) {
        return Err(bad());
    }
    let tabs = value["tabs"].as_array().ok_or_else(bad)?;
    if tabs.is_empty() || tabs.len() > 128 {
        return Err(bad());
    }
    if integer(&value["nextId"], MAX_SAFE_INTEGER)? == 0 {
        return Err(bad());
    }
    integer(&value["counts"]["text"], MAX_SAFE_INTEGER)?;
    integer(&value["counts"]["sheet"], MAX_SAFE_INTEGER)?;
    let mut ids = HashSet::new();
    for tab in tabs {
        let id = integer(&tab["id"], MAX_SAFE_INTEGER)?;
        if id == 0 || !ids.insert(id) {
            return Err(bad());
        }
        text(&tab["title"], 200)?;
        let kind = tab["kind"].as_str().ok_or_else(bad)?;
        if kind != "text" && kind != "sheet" {
            return Err(bad());
        }
        value_for_kind(&tab["history"]["present"], kind)?;
        for key in ["past", "future"] {
            if let Some(values) = tab["history"].get(key) {
                let values = values.as_array().ok_or_else(bad)?;
                if values.len() > 100 {
                    return Err(bad());
                }
                for value in values {
                    value_for_kind(value, kind)?;
                }
            }
        }
        if let Some(scroll) = tab.get("scroll") {
            for key in ["top", "left"] {
                let number = scroll[key].as_f64().ok_or_else(bad)?;
                if !number.is_finite() || !(0.0..=1_000_000_000.0).contains(&number) {
                    return Err(bad());
                }
            }
        }
        if let Some(selection) = tab.get("selection") {
            if kind == "text" {
                integer(&selection["start"], MAX_SAFE_INTEGER)?;
                integer(&selection["end"], MAX_SAFE_INTEGER)?;
                if let Some(direction) = selection.get("direction").filter(|value| !value.is_null())
                {
                    if !matches!(direction.as_str(), Some("none" | "forward" | "backward")) {
                        return Err(bad());
                    }
                }
            } else {
                if !matches!(
                    selection["kind"].as_str(),
                    Some("cells" | "rows" | "columns")
                ) {
                    return Err(bad());
                }
                coordinate(&selection["start"])?;
                coordinate(&selection["end"])?;
                let (rows, columns) = sheet(&tab["history"]["present"])?;
                for (key, length) in [("rows", rows), ("columns", columns)] {
                    if let Some(indices) = selection.get(key) {
                        let indices = indices.as_array().ok_or_else(bad)?;
                        if indices.len() > length {
                            return Err(bad());
                        }
                        for index in indices {
                            integer(index, (length - 1) as u64)?;
                        }
                    }
                }
            }
        }
        if kind == "sheet" {
            for key in ["activeCell", "cellAnchor"] {
                if let Some(point) = tab.get(key) {
                    coordinate(point)?;
                }
            }
            for key in ["rowAnchor", "columnAnchor"] {
                if let Some(index) = tab.get(key) {
                    integer(index, MAX_SAFE_INTEGER)?;
                }
            }
            if let Some(result) = tab.get("result").filter(|result| !result.is_null()) {
                text(&result["name"], 200)?;
                text(&result["value"], MAX_TEXT)?;
            }
        }
    }
    if !ids.contains(&integer(&value["activeId"], MAX_SAFE_INTEGER)?) {
        return Err(bad());
    }
    Ok(value)
}
fn validate_manifest(value: Value) -> Result<Manifest, String> {
    let mut manifest: Manifest =
        serde_json::from_value(value).map_err(|_| "The window list is invalid.".to_string())?;
    if manifest.version != 1 || manifest.windows.len() > MAX_WINDOWS {
        return Err("The window list version or size is invalid.".into());
    }
    let mut ids = HashSet::new();
    for window in &mut manifest.windows {
        if !valid_id(&window.id)
            || !ids.insert(window.id.clone())
            || normalize_name(&window.name).is_err()
        {
            return Err("The saved window identity is invalid.".into());
        }
        window.name = normalize_name(&window.name)?;
        let bounds = &window.bounds;
        if !bounds.x.is_finite()
            || !bounds.y.is_finite()
            || !(-100_000.0..=100_000.0).contains(&bounds.x)
            || !(-100_000.0..=100_000.0).contains(&bounds.y)
            || !(320.0..=10_000.0).contains(&bounds.width)
            || !(360.0..=10_000.0).contains(&bounds.height)
        {
            return Err("The saved window bounds are invalid.".into());
        }
    }
    if !manifest
        .focused_id
        .as_ref()
        .is_some_and(|id| ids.contains(id))
    {
        manifest.focused_id = manifest.windows.first().map(|window| window.id.clone());
    }
    Ok(manifest)
}

pub struct SessionStore {
    root: PathBuf,
    // OS-owned exclusive lock lives exactly as long as the store; no sockets or stale PID files.
    _process_lock: fs::File,
    good: HashMap<PathBuf, Vec<u8>>,
    repair: HashSet<PathBuf>,
    pub recovered: bool,
}
impl SessionStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let process_lock = options
            .open(root.join("session.lock"))
            .map_err(|error| error.to_string())?;
        process_lock.try_lock().map_err(|error| match error {
            fs::TryLockError::WouldBlock => {
                "Scratchpad is already running. Use its Dock icon to reopen your windows."
                    .to_owned()
            }
            fs::TryLockError::Error(error) => {
                format!("The local session could not be locked safely: {error}")
            }
        })?;
        Ok(Self {
            root,
            _process_lock: process_lock,
            good: HashMap::new(),
            repair: HashSet::new(),
            recovered: false,
        })
    }
    fn workspace_path(&self, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("Invalid window identity.".into());
        }
        Ok(self.root.join(format!("{id}.json")))
    }
    fn read(
        &mut self,
        path: &Path,
        maximum: usize,
        validate: impl Fn(Value) -> Result<Value, String>,
    ) -> Result<Option<Value>, String> {
        let backup = path.with_extension("json.bak");
        let mut damaged = false;
        for candidate in [path, backup.as_path()] {
            if !candidate.exists() {
                continue;
            }
            let loaded = (|| {
                let info = fs::symlink_metadata(candidate).map_err(|error| error.to_string())?;
                if !info.is_file() || info.len() > maximum as u64 {
                    return Err("Invalid session file size or type.".into());
                }
                let bytes = fs::read(candidate).map_err(|error| error.to_string())?;
                let value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
                validate(value)
            })();
            match loaded {
                Ok(value) => {
                    self.good.insert(
                        path.to_path_buf(),
                        serde_json::to_vec(&value).map_err(|error| error.to_string())?,
                    );
                    self.recovered |= candidate != path;
                    if candidate != path {
                        self.repair.insert(path.to_path_buf());
                    }
                    return Ok(Some(value));
                }
                Err(_) => {
                    damaged = true;
                    // Preserve evidence before any later repair. Originals also remain untouched.
                    let recovery =
                        candidate.with_extension(format!("recovery-{}.json", Uuid::new_v4()));
                    let _ = fs::copy(candidate, recovery);
                }
            }
        }
        if damaged {
            Err("The saved session and backup could not be read. Recovery files have been retained.".into())
        } else {
            Ok(None)
        }
    }
    pub fn load_manifest(&mut self) -> Result<Manifest, String> {
        let file = self.root.join("session.json");
        self.read(&file, 1024 * 1024, |value| {
            let valid = validate_manifest(value)?;
            serde_json::to_value(valid).map_err(|error| error.to_string())
        })?
        .map(validate_manifest)
        .transpose()
        .map(|value| value.unwrap_or_default())
    }
    pub fn load_workspace(&mut self, id: &str) -> Result<Option<Value>, String> {
        let file = self.workspace_path(id)?;
        self.read(&file, MAX_WORKSPACE_BYTES, validate_workspace)
    }
    fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
        let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|error| error.to_string())?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| error.to_string())?;
            drop(file);
            fs::rename(&temporary, path).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                if let Some(parent) = path.parent() {
                    fs::File::open(parent)
                        .and_then(|file| file.sync_all())
                        .map_err(|error| error.to_string())?;
                }
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    fn write(&mut self, path: &Path, value: &impl Serialize, maximum: usize) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        if bytes.len() > maximum {
            return Err("The session is too large to save. Split it into smaller windows.".into());
        }
        if self.good.get(path) == Some(&bytes) && !self.repair.contains(path) {
            return Ok(());
        }
        if let Some(previous) = self.good.get(path) {
            Self::atomic_write(&path.with_extension("json.bak"), previous)?;
        }
        Self::atomic_write(path, &bytes)?;
        self.good.insert(path.to_path_buf(), bytes);
        self.repair.remove(path);
        Ok(())
    }
    pub fn save_workspace(&mut self, id: &str, value: Value) -> Result<Value, String> {
        let value = validate_workspace(value)?;
        let file = self.workspace_path(id)?;
        self.write(&file, &value, MAX_WORKSPACE_BYTES)?;
        Ok(value)
    }
    pub fn save_manifest(&mut self, manifest: &Manifest) -> Result<(), String> {
        validate_manifest(serde_json::to_value(manifest).map_err(|error| error.to_string())?)?;
        let file = self.root.join("session.json");
        self.write(&file, manifest, 1024 * 1024)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn workspace(text: &str) -> Value {
        json!({"version":1,"nextId":2,"counts":{"text":1,"sheet":0},"activeId":1,
            "tabs":[{"id":1,"title":"Test","kind":"text","history":{"past":[],"present":text,"future":[]},
                "selection":{"start":0,"end":0,"direction":"none"},"scroll":{"top":0,"left":0}}]})
    }
    #[test]
    fn rejects_bad_snapshots_and_keeps_history() {
        assert!(validate_workspace(workspace("hello")).is_ok());
        let mut invalid = workspace("hello");
        invalid["version"] = json!(2);
        assert!(validate_workspace(invalid).is_err());
        let mut invalid = workspace("hello");
        invalid["tabs"][0]["history"]["past"] = json!([false]);
        assert!(validate_workspace(invalid).is_err());
        let mut valid = workspace("hello");
        valid["tabs"][0]["history"]["past"] = json!(["previous"]);
        assert_eq!(
            validate_workspace(valid).unwrap()["tabs"][0]["history"]["past"][0],
            "previous"
        );
    }
    #[test]
    fn rejects_unsafe_ids_and_names() {
        assert!(!valid_id("../../session"));
        assert!(!valid_id("scratchpad-not-a-uuid"));
        assert!(normalize_name(" \n ").is_err());
        assert_eq!(normalize_name("Research\nNotes").unwrap(), "ResearchNotes");
    }
    #[test]
    fn preserves_the_renderer_content_limit_with_metadata() {
        let mut value = workspace(&"x".repeat(MAX_TEXT));
        value["tabs"][0]["history"]["past"] = json!(["y".repeat(MAX_TEXT - 4)]);
        assert!(
            validate_workspace(value).is_ok(),
            "the four title characters are the only other content"
        );
    }
    #[test]
    fn normalizes_saved_names_and_stale_focus() {
        let id = format!("scratchpad-{}", Uuid::new_v4());
        let valid = validate_manifest(json!({"version":1,"focusedId":"missing","windows":[{
            "id":id,"name":" Notes\n ","alwaysOnTop":false
        }]}))
        .unwrap();
        assert_eq!(valid.windows[0].name, "Notes");
        assert_eq!(valid.focused_id.as_ref(), Some(&valid.windows[0].id));
    }
    #[test]
    fn recovers_atomic_backup_and_fails_closed_without_one() {
        let directory =
            std::env::temp_dir().join(format!("scratchpad-session-test-{}", Uuid::new_v4()));
        let id = format!("scratchpad-{}", Uuid::new_v4());
        let mut store = SessionStore::new(directory.clone()).unwrap();
        store.save_workspace(&id, workspace("first")).unwrap();
        store.save_workspace(&id, workspace("second")).unwrap();
        store.save_workspace(&id, workspace("second")).unwrap();
        let backup: Value =
            serde_json::from_slice(&fs::read(directory.join(format!("{id}.json.bak"))).unwrap())
                .unwrap();
        assert_eq!(
            backup["tabs"][0]["history"]["present"], "first",
            "unchanged saves must retain the previous revision"
        );
        assert!(
            SessionStore::new(directory.clone()).is_err(),
            "another process/store must not share the session"
        );
        drop(store);
        fs::write(directory.join(format!("{id}.json")), b"corrupt").unwrap();
        let mut loaded = SessionStore::new(directory.clone()).unwrap();
        assert_eq!(
            loaded.load_workspace(&id).unwrap().unwrap()["tabs"][0]["history"]["present"],
            "first"
        );
        assert!(loaded.recovered);
        loaded.save_workspace(&id, workspace("first")).unwrap();
        let repaired: Value =
            serde_json::from_slice(&fs::read(directory.join(format!("{id}.json"))).unwrap())
                .unwrap();
        assert_eq!(
            repaired["tabs"][0]["history"]["present"], "first",
            "identical recovered data must repair the damaged primary"
        );
        drop(loaded);
        fs::write(directory.join(format!("{id}.json")), b"corrupt again").unwrap();
        fs::write(directory.join(format!("{id}.json.bak")), b"corrupt too").unwrap();
        assert!(SessionStore::new(directory.clone())
            .unwrap()
            .load_workspace(&id)
            .is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
