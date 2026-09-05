//! Narrow native shell: no network, arbitrary paths, shell access or renderer-created windows.
use crate::session::{normalize_name, Bounds, Manifest, SessionStore, WindowMetadata, MAX_WINDOWS};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Write,
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use uuid::Uuid;

struct Entry {
    metadata: WindowMetadata,
    workspace: Option<Value>,
    load_error: Option<String>,
    loaded: bool,
    ready: bool,
    closing: bool,
    exporting: bool,
    close_queued: bool,
}
struct PendingFlush {
    label: String,
    completion: mpsc::Sender<Result<(), String>>,
}
struct Inner {
    store: SessionStore,
    windows: BTreeMap<String, Entry>,
    focused: Option<String>,
    pending: HashMap<String, PendingFlush>,
    quitting: bool,
    quit_queued: bool,
    restoring: bool,
    exit_approved: bool,
    manifest_scheduled: bool,
}
struct Desktop {
    inner: Mutex<Inner>,
}
struct StartupFailed;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    id: String,
    name: String,
    always_on_top: bool,
}
#[derive(Serialize)]
pub struct LoadResponse {
    workspace: Option<Value>,
    window: WindowInfo,
}
fn info(entry: &Entry) -> WindowInfo {
    WindowInfo {
        id: entry.metadata.id.clone(),
        name: entry.metadata.name.clone(),
        always_on_top: entry.metadata.always_on_top,
    }
}
fn with_state<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut Inner) -> Result<T, String>,
) -> Result<T, String> {
    if app.try_state::<StartupFailed>().is_some() {
        return Err("The local session did not start safely.".into());
    }
    let state = app
        .try_state::<Desktop>()
        .ok_or("The local session has not initialized.")?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "The desktop session lock could not be acquired.".to_string())?;
    operation(&mut inner)
}
fn manifest(inner: &Inner) -> Manifest {
    Manifest {
        version: 1,
        windows: inner
            .windows
            .values()
            .map(|entry| entry.metadata.clone())
            .collect(),
        focused_id: inner.focused.clone(),
    }
}
fn persist_manifest(inner: &mut Inner) -> Result<(), String> {
    if inner.restoring {
        return Err("The saved windows are still being restored.".into());
    }
    let next = manifest(inner);
    inner.store.save_manifest(&next)
}
pub fn allowed_navigation(url: &tauri::Url) -> bool {
    crate::platform::allowed_navigation(url)
}
fn caller(app: &AppHandle, window: &WebviewWindow) -> Result<String, String> {
    if !allowed_navigation(&window.url().map_err(|error| error.to_string())?) {
        return Err("This page cannot access the desktop session.".into());
    }
    let label = window.label().to_string();
    with_state(app, |inner| {
        if inner.windows.contains_key(&label) {
            Ok(label)
        } else {
            Err("The desktop window is no longer open.".into())
        }
    })
}
fn report(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[tauri::command]
pub async fn desktop_load(app: AppHandle, window: WebviewWindow) -> Result<LoadResponse, String> {
    let label = caller(&app, &window)?;
    with_state(&app, |inner| {
        let entry = inner.windows.get_mut(&label).ok_or("Unknown window")?;
        if let Some(error) = &entry.load_error {
            return Err(error.clone());
        }
        // Once load succeeds, close must request a snapshot even before the first autosave.
        entry.loaded = true;
        Ok(LoadResponse {
            workspace: entry.workspace.clone(),
            window: info(entry),
        })
    })
}
#[tauri::command]
pub async fn desktop_ready(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let label = caller(&app, &window)?;
    with_state(&app, |inner| {
        inner.windows.get_mut(&label).ok_or("Unknown window")?.ready = true;
        Ok(())
    })
}
#[tauri::command]
pub async fn desktop_save(
    app: AppHandle,
    window: WebviewWindow,
    workspace: Value,
) -> Result<(), String> {
    let label = caller(&app, &window)?;
    with_state(&app, |inner| {
        let entry = inner.windows.get(&label).ok_or("Unknown window")?;
        if !entry.loaded || entry.load_error.is_some() {
            return Err("The saved workspace has not been loaded safely.".into());
        }
        let workspace = inner.store.save_workspace(&label, workspace)?;
        inner
            .windows
            .get_mut(&label)
            .ok_or("Unknown window")?
            .workspace = Some(workspace);
        Ok(())
    })
}
#[tauri::command]
pub async fn desktop_rename(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
) -> Result<String, String> {
    let label = caller(&app, &window)?;
    let name = normalize_name(&name)?;
    let next_info = with_state(&app, |inner| {
        if inner.quitting || inner.windows.get(&label).is_some_and(|entry| entry.closing) {
            return Err("Wait until the window has finished saving.".into());
        }
        let previous = inner
            .windows
            .get(&label)
            .ok_or("Unknown window")?
            .metadata
            .name
            .clone();
        inner
            .windows
            .get_mut(&label)
            .ok_or("Unknown window")?
            .metadata
            .name = name.clone();
        if let Err(error) = persist_manifest(inner) {
            inner
                .windows
                .get_mut(&label)
                .ok_or("Unknown window")?
                .metadata
                .name = previous;
            return Err(error);
        }
        Ok(info(inner.windows.get(&label).ok_or("Unknown window")?))
    })?;
    window.set_title(&name).map_err(|error| error.to_string())?;
    app.emit_to(label, "desktop:window-info", next_info)
        .map_err(|error| error.to_string())?;
    rebuild_menu(&app).map_err(|error| error.to_string())?;
    Ok(name)
}
#[tauri::command]
pub async fn desktop_flushed(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    workspace: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let label = caller(&app, &window)?;
    with_state(&app, |inner| {
        if !inner
            .pending
            .get(&request_id)
            .is_some_and(|pending| pending.label == label)
        {
            return Err("This save request does not belong to the window.".into());
        }
        let pending = inner
            .pending
            .remove(&request_id)
            .ok_or("The save request has expired.")?;
        let result = if error.is_some() {
            Err("The editor could not capture its latest state.".into())
        } else if let Some(workspace) = workspace {
            inner
                .store
                .save_workspace(&label, workspace)
                .and_then(|workspace| {
                    inner
                        .windows
                        .get_mut(&label)
                        .ok_or("Unknown window")?
                        .workspace = Some(workspace);
                    Ok(())
                })
        } else {
            Err("The editor did not return a workspace.".into())
        };
        let _ = pending.completion.send(result);
        Ok(())
    })
}
fn check_export(text: &str) -> Result<(), String> {
    if text.len() > 32 * 1024 * 1024 || text.encode_utf16().count() > 8 * 1024 * 1024 {
        Err("This text is too large to export in one operation.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn desktop_copy_text(
    app: AppHandle,
    window: WebviewWindow,
    text: String,
) -> Result<(), String> {
    caller(&app, &window)?;
    check_export(&text)?;
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn desktop_save_file(
    app: AppHandle,
    window: WebviewWindow,
    text: String,
    kind: String,
) -> Result<bool, String> {
    let label = caller(&app, &window)?;
    check_export(&text)?;
    let (filename, extension) = match kind.as_str() {
        "text" => ("scratchpad.txt", "txt"),
        "sheet" => ("cellpad.csv", "csv"),
        _ => return Err("Unknown export type.".into()),
    };
    with_state(&app, |inner| {
        if inner.quitting || inner.quit_queued || inner.restoring {
            return Err("Wait until the current window operation finishes.".into());
        }
        let entry = inner.windows.get_mut(&label).ok_or("Unknown window")?;
        if entry.closing || entry.exporting {
            return Err("A window save is already in progress.".into());
        }
        entry.exporting = true;
        Ok(())
    })?;
    let result = (|| {
        let destination = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(filename)
            .add_filter("Scratchpad export", &[extension])
            .blocking_save_file();
        let Some(destination) = destination else {
            return Ok(false);
        };
        // The path originates exclusively in the native user-selected Save dialog.
        // Its sandbox grant need not include siblings, so do not attempt a sibling-temp
        // rename. Export failures are visible; session autosaves use atomic replacement.
        let destination = destination.into_path().map_err(|error| error.to_string())?;
        let mut file = fs::File::create(destination).map_err(|error| error.to_string())?;
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(true)
    })();
    let (close, quit) = with_state(&app, |inner| {
        let entry = inner.windows.get_mut(&label).ok_or("Unknown window")?;
        entry.exporting = false;
        let close = entry.close_queued && result.is_ok();
        entry.close_queued = false;
        if result.is_err() {
            inner.quit_queued = false;
        }
        Ok((close, inner.quit_queued))
    })?;
    if close {
        begin_close(&app, &label);
    } else if quit {
        begin_quit(&app);
    }
    result
}

pub fn window_entries(app: &AppHandle) -> Vec<(String, String, bool)> {
    with_state(app, |inner| {
        Ok(inner
            .windows
            .values()
            .map(|entry| {
                (
                    entry.metadata.id.clone(),
                    entry.metadata.name.clone(),
                    inner.focused.as_deref() == Some(entry.metadata.id.as_str()),
                )
            })
            .collect())
    })
    .unwrap_or_default()
}
pub fn exit_approved(app: &AppHandle) -> bool {
    app.try_state::<StartupFailed>().is_some()
        || with_state(app, |inner| Ok(inner.exit_approved)).unwrap_or(false)
}
fn active_label(app: &AppHandle) -> Option<String> {
    with_state(app, |inner| {
        Ok(inner
            .focused
            .clone()
            .filter(|label| inner.windows.contains_key(label))
            .or_else(|| inner.windows.keys().next().cloned()))
    })
    .ok()
    .flatten()
}
fn schedule_manifest(app: &AppHandle) {
    let start = with_state(app, |inner| {
        if inner.manifest_scheduled || inner.quitting || inner.restoring {
            return Ok(false);
        }
        inner.manifest_scheduled = true;
        Ok(true)
    })
    .unwrap_or(false);
    if !start {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        let _ = with_state(&app, |inner| {
            inner.manifest_scheduled = false;
            if !inner.quitting && !inner.restoring {
                persist_manifest(inner)?;
            }
            Ok(())
        });
    });
}
fn update_metadata(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let maximized = window.is_maximized().unwrap_or(false);
    let full_screen = window.is_fullscreen().unwrap_or(false);
    let size = window.inner_size().ok();
    let position = window.outer_position().ok();
    let focused = window.is_focused().unwrap_or(false);
    let _ = with_state(app, |inner| {
        if let Some(entry) = inner.windows.get_mut(label) {
            entry.metadata.maximized = maximized;
            entry.metadata.full_screen = full_screen;
            if !maximized && !full_screen {
                if let Some(size) = size {
                    entry.metadata.bounds.width =
                        (size.width as f64 / scale).clamp(320.0, 10_000.0);
                    entry.metadata.bounds.height =
                        (size.height as f64 / scale).clamp(360.0, 10_000.0);
                }
                if let Some(position) = position {
                    entry.metadata.bounds.x =
                        (position.x as f64 / scale).clamp(-100_000.0, 100_000.0);
                    entry.metadata.bounds.y =
                        (position.y as f64 / scale).clamp(-100_000.0, 100_000.0);
                }
            }
            if focused {
                inner.focused = Some(label.to_owned());
            }
        }
        Ok(())
    });
    schedule_manifest(app);
}
fn create_window(app: &AppHandle, saved: Option<Entry>, focus: bool) -> Result<(), String> {
    let metadata = with_state(app, |inner| {
        if inner.quitting || inner.quit_queued {
            return Err("Wait until quitting has finished.".into());
        }
        if inner.windows.len() >= MAX_WINDOWS {
            return Err("Keep at most 32 Scratchpad windows open at once.".into());
        }
        let entry = if let Some(entry) = saved {
            entry
        } else {
            let mut number = 1;
            while inner
                .windows
                .values()
                .any(|entry| entry.metadata.name == format!("Scratchpad {number}"))
            {
                number += 1;
            }
            Entry {
                metadata: WindowMetadata {
                    id: format!("scratchpad-{}", Uuid::new_v4()),
                    name: format!("Scratchpad {number}"),
                    bounds: Bounds::default(),
                    always_on_top: false,
                    maximized: false,
                    full_screen: false,
                },
                workspace: None,
                load_error: None,
                loaded: false,
                ready: false,
                closing: false,
                exporting: false,
                close_queued: false,
            }
        };
        let metadata = entry.metadata.clone();
        if focus {
            inner.focused = Some(metadata.id.clone());
        }
        inner.windows.insert(metadata.id.clone(), entry);
        Ok(metadata)
    })?;
    let builder =
        WebviewWindowBuilder::new(app, &metadata.id, WebviewUrl::App("index.html".into()))
            .title(&metadata.name)
            .inner_size(metadata.bounds.width, metadata.bounds.height)
            .position(metadata.bounds.x, metadata.bounds.y)
            .min_inner_size(320.0, 360.0)
            .prevent_overflow()
            .visible(false)
            .focused(focus)
            .always_on_top(metadata.always_on_top)
            .maximized(metadata.maximized)
            .fullscreen(metadata.full_screen)
            .devtools(false)
            .disable_drag_drop_handler()
            .on_navigation(allowed_navigation)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .on_document_title_changed(|window, _| {
                if let Ok(name) = with_state(window.app_handle(), |inner| {
                    inner
                        .windows
                        .get(window.label())
                        .map(|entry| entry.metadata.name.clone())
                        .ok_or("Unknown window".into())
                }) {
                    let _ = window.set_title(&name);
                }
            });
    let result = (|| {
        let window = crate::platform::configure_builder(builder)?
            .build()
            .map_err(|error| error.to_string())?;
        let finish = (|| {
            crate::platform::finish_window(&window)?;
            window.show().map_err(|error| error.to_string())?;
            if focus {
                window.set_focus().map_err(|error| error.to_string())?;
            }
            Ok::<(), String>(())
        })();
        if let Err(error) = finish {
            let _ = window.destroy();
            return Err(error);
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = with_state(app, |inner| {
            inner.windows.remove(&metadata.id);
            if inner.focused.as_deref() == Some(metadata.id.as_str()) {
                inner.focused = inner.windows.keys().next().cloned();
            }
            Ok(())
        });
        return Err(error.to_string());
    }
    rebuild_menu(app).map_err(|error| error.to_string())?;
    schedule_manifest(app);
    Ok(())
}
fn flush_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    let request_id = Uuid::new_v4().to_string();
    let needed = with_state(app, |inner| {
        let Some(entry) = inner.windows.get(label) else {
            return Ok(false);
        };
        if !entry.loaded && !entry.ready {
            return Ok(false);
        }
        inner.pending.insert(
            request_id.clone(),
            PendingFlush {
                label: label.to_owned(),
                completion: sender,
            },
        );
        Ok(true)
    })?;
    if !needed {
        return Ok(());
    }
    if let Err(error) = app.emit_to(label, "desktop:flush", json!({"requestId": request_id})) {
        let _ = with_state(app, |inner| {
            inner.pending.remove(&request_id);
            Ok(())
        });
        return Err(error.to_string());
    }
    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(result) => result,
        Err(_) => {
            let _ = with_state(app, |inner| {
                inner.pending.remove(&request_id);
                Ok(())
            });
            Err("The editor did not respond to the save request. Your last successful save is retained.".into())
        }
    }
}
fn begin_close(app: &AppHandle, label: &str) {
    // Without a Dock/tray there must be no invisible Windows process. Closing the last
    // window follows Quit, preserving its session for the next launch.
    #[cfg(target_os = "windows")]
    if with_state(app, |inner| {
        Ok(inner
            .windows
            .values()
            .filter(|entry| !entry.closing)
            .count()
            == 1
            && inner.windows.get(label).is_some_and(|entry| !entry.closing))
    })
    .unwrap_or(false)
    {
        begin_quit(app);
        return;
    }
    let start = with_state(app, |inner| {
        if inner.quitting || inner.restoring {
            return Ok(false);
        }
        let Some(entry) = inner.windows.get_mut(label) else {
            return Ok(false);
        };
        if entry.closing {
            return Ok(false);
        }
        // On macOS the Save panel and set_enabled(false) both use native sheets.
        // Wait for the existing panel/write rather than attaching a second sheet.
        if entry.exporting {
            entry.close_queued = true;
            return Ok(false);
        }
        entry.closing = true;
        Ok(true)
    })
    .unwrap_or(false);
    if !start {
        return;
    }
    update_metadata(app, label);
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_enabled(false);
    }
    let _ = rebuild_menu(app);
    let app = app.clone();
    let label = label.to_owned();
    std::thread::spawn(move || {
        let result = flush_window(&app, &label).and_then(|_| {
            with_state(&app, |inner| {
                let mut next = manifest(inner);
                next.windows.retain(|window| window.id != label);
                if next.focused_id.as_deref() == Some(label.as_str()) {
                    next.focused_id = next.windows.first().map(|window| window.id.clone());
                }
                inner.store.save_manifest(&next)?;
                inner.focused = next.focused_id;
                Ok(inner.windows.remove(&label))
            })
        });
        match result {
            Ok(removed) => {
                if let Some(window) = app.get_webview_window(&label) {
                    if let Err(error) = window.destroy() {
                        let _ = with_state(&app, |inner| {
                            if let Some(mut entry) = removed {
                                entry.closing = false;
                                inner.windows.insert(label.clone(), entry);
                                inner.focused = Some(label.clone());
                            }
                            inner.quit_queued = false;
                            persist_manifest(inner)
                        });
                        let _ = window.set_enabled(true);
                        report(&app, "The window could not close", &error.to_string());
                    }
                }
            }
            Err(error) => {
                let _ = with_state(&app, |inner| {
                    if let Some(entry) = inner.windows.get_mut(&label) {
                        entry.closing = false;
                    }
                    // A failed close cancels a queued quit as well; do not immediately retry the failed save.
                    inner.quit_queued = false;
                    Ok(())
                });
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.set_enabled(true);
                }
                report(
                    &app,
                    "The window was kept open",
                    &format!("{error}\nFix the save problem, then close the window again."),
                );
            }
        }
        let _ = rebuild_menu(&app);
        let resume_quit = with_state(&app, |inner| {
            Ok(inner.quit_queued && !inner.windows.values().any(|entry| entry.closing))
        })
        .unwrap_or(false);
        if resume_quit {
            begin_quit(&app);
        }
    });
}
fn begin_quit(app: &AppHandle) {
    let labels = with_state(app, |inner| {
        if inner.quitting {
            return Ok(None);
        }
        if inner.restoring
            || inner
                .windows
                .values()
                .any(|entry| entry.closing || entry.exporting)
        {
            inner.quit_queued = true;
            return Ok(None);
        }
        inner.quit_queued = false;
        inner.quitting = true;
        Ok(Some(inner.windows.keys().cloned().collect::<Vec<_>>()))
    })
    .ok()
    .flatten();
    let Some(labels) = labels else {
        return;
    };
    for label in &labels {
        update_metadata(app, label);
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_enabled(false);
        }
    }
    let _ = rebuild_menu(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = std::thread::scope(|scope| {
            let jobs: Vec<_> = labels
                .iter()
                .map(|label| {
                    let app = &app;
                    scope.spawn(move || flush_window(app, label))
                })
                .collect();
            // Join every worker before propagating the first failure; otherwise an
            // unjoined worker panic could unwind the scope and strand disabled windows.
            let results: Vec<_> = jobs
                .into_iter()
                .map(|job| {
                    job.join()
                        .unwrap_or_else(|_| Err("A window save stopped unexpectedly.".into()))
                })
                .collect();
            results.into_iter().collect::<Result<Vec<_>, String>>()
        })
        .and_then(|_| {
            with_state(&app, |inner| {
                persist_manifest(inner)?;
                inner.exit_approved = true;
                Ok(())
            })
        });
        match result {
            Ok(()) => app.exit(0),
            Err(error) => {
                let _ = with_state(&app, |inner| {
                    inner.quitting = false;
                    Ok(())
                });
                for label in labels {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.set_enabled(true);
                    }
                }
                let _ = rebuild_menu(&app);
                report(&app, "Scratchpad was kept open", &format!("{error}\nYour previous saves are retained. Fix the save problem, then quit again."));
            }
        }
    });
}
fn focus_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
pub fn menu_action(app: &AppHandle, action: &str) {
    if app.try_state::<StartupFailed>().is_some() {
        if action == "quit" {
            app.exit(1);
        }
        return;
    }
    if action == "quit" {
        begin_quit(app);
        return;
    }
    let allowed = with_state(app, |inner| Ok(!inner.quitting && !inner.restoring)).unwrap_or(false);
    if !allowed {
        return;
    }
    if action == "new-window" {
        #[cfg(target_os = "windows")]
        {
            // Calling run_on_main_thread from this thread would run inline. A worker
            // queues a fresh Tauri task after the native menu callback has returned.
            // Environment creation/use and every COM interface remain on the UI STA.
            let handle = app.clone();
            std::thread::spawn(move || {
                let task_handle = handle.clone();
                if let Err(error) = handle.run_on_main_thread(move || {
                    if let Err(error) = create_window(&task_handle, None, true) {
                        report(&task_handle, "A window could not be opened", &error);
                    }
                }) {
                    report(&handle, "A window could not be opened", &error.to_string());
                }
            });
        }
        #[cfg(not(target_os = "windows"))]
        if let Err(error) = create_window(app, None, true) {
            report(app, "A window could not be opened", &error);
        }
        return;
    }
    if let Some(label) = action.strip_prefix("focus:") {
        focus_window(app, label);
        return;
    }
    let Some(label) = active_label(app) else {
        return;
    };
    if with_state(app, |inner| {
        Ok(inner.windows.get(&label).is_some_and(|entry| entry.closing))
    })
    .unwrap_or(true)
    {
        return;
    }
    match action {
        "close-window" => begin_close(app, &label),
        "undo" | "redo" | "commands" | "rename-window" => {
            let _ = app.emit_to(label, "desktop:action", json!({"type": action}));
        }
        "always-on-top" => {
            let value = with_state(app, |inner| {
                let entry = inner.windows.get_mut(&label).ok_or("Unknown window")?;
                entry.metadata.always_on_top = !entry.metadata.always_on_top;
                Ok(info(entry))
            });
            if let Ok(value) = value {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.set_always_on_top(value.always_on_top);
                }
                let _ = app.emit_to(&label, "desktop:window-info", value);
                schedule_manifest(app);
                let _ = rebuild_menu(app);
            }
        }
        _ => (),
    }
}
fn rebuild_menu(app: &AppHandle) -> tauri::Result<()> {
    let (windows, focused, enabled, closing) = with_state(app, |inner| {
        Ok((
            inner
                .windows
                .values()
                .map(|entry| entry.metadata.clone())
                .collect::<Vec<_>>(),
            inner.focused.clone(),
            !inner.quitting && !inner.restoring,
            inner
                .windows
                .values()
                .filter(|entry| entry.closing)
                .map(|entry| entry.metadata.id.clone())
                .collect::<Vec<_>>(),
        ))
    })
    .unwrap_or_default();
    let active = windows
        .iter()
        .find(|window| Some(&window.id) == focused.as_ref())
        .or_else(|| windows.first());
    let editable = enabled && active.is_some_and(|entry| !closing.contains(&entry.id));
    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "Scratchpad",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Scratchpad"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Scratchpad", enabled, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    let app_menu = Submenu::with_items(
        app,
        "Scratchpad",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Scratchpad"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit Scratchpad", enabled, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                "new-window",
                "New Window",
                enabled && windows.len() < MAX_WINDOWS,
                Some("CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                app,
                "close-window",
                "Close Window",
                editable,
                Some("CmdOrCtrl+W"),
            )?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        editable,
        &[
            // These actions intentionally have no native accelerators: the renderer owns Z/Y/J.
            &MenuItem::with_id(app, "undo", "Undo", editable, None::<&str>)?,
            &MenuItem::with_id(app, "redo", "Redo", editable, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "commands", "Commands…", editable, None::<&str>)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        editable,
        &[
            &MenuItem::with_id(
                app,
                "rename-window",
                "Rename Window…",
                editable,
                Some("CmdOrCtrl+Shift+R"),
            )?,
            &CheckMenuItem::with_id(
                app,
                "always-on-top",
                "Always on Top",
                editable,
                active.is_some_and(|entry| entry.always_on_top),
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;
    if !windows.is_empty() {
        window_menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for window in windows {
        window_menu.append(&CheckMenuItem::with_id(
            app,
            format!("focus:{}", window.id),
            window.name.replace('&', "&&"),
            enabled,
            Some(&window.id) == focused.as_ref(),
            None::<&str>,
        )?)?;
    }
    app.set_menu(Menu::with_items(
        app,
        &[&app_menu, &file, &edit, &window_menu],
    )?)?;
    Ok(())
}
pub fn setup(app: &mut tauri::App) -> Result<(), String> {
    crate::platform::prepare(app.handle())?;
    let root = crate::platform::session_root(app.handle())?;
    let mut store = SessionStore::new(root)?;
    let saved = store.load_manifest()?;
    let mut entries = Vec::new();
    for metadata in saved.windows {
        let loaded = store.load_workspace(&metadata.id);
        let (workspace, load_error) = match loaded {
            Ok(value) => (value, None),
            Err(error) => (None, Some(error)),
        };
        entries.push(Entry {
            metadata,
            workspace,
            load_error,
            loaded: false,
            ready: false,
            closing: false,
            exporting: false,
            close_queued: false,
        });
    }
    let recovered = store.recovered;
    let focused = saved.focused_id;
    app.manage(Desktop {
        inner: Mutex::new(Inner {
            store,
            windows: BTreeMap::new(),
            focused: focused.clone(),
            pending: HashMap::new(),
            quitting: false,
            quit_queued: false,
            restoring: true,
            exit_approved: false,
            manifest_scheduled: false,
        }),
    });
    crate::platform::install_native_menu(app.handle())?;
    if entries.is_empty() {
        create_window(app.handle(), None, true)?;
    } else {
        for entry in entries {
            let focus = Some(&entry.metadata.id) == focused.as_ref();
            create_window(app.handle(), Some(entry), focus)?;
        }
    }
    // Do not replace the original full manifest with a prefix during slow or failed startup.
    with_state(app.handle(), |inner| {
        inner.restoring = false;
        persist_manifest(inner)
    })?;
    rebuild_menu(app.handle()).map_err(|error| error.to_string())?;
    if with_state(app.handle(), |inner| Ok(inner.quit_queued))? {
        begin_quit(app.handle());
    }
    if recovered {
        app.dialog().message("A window was restored from its backup. Its original recovery files remain on this device.")
        .title("Saved workspace recovered").kind(MessageDialogKind::Warning).show(|_| {});
    }
    Ok(())
}
pub fn startup_failed(app: &tauri::App, error: String) {
    // Keep the event loop alive only long enough to show a native, actionable failure.
    // No partially restored window may subsequently overwrite the original manifest.
    app.manage(StartupFailed);
    for window in app.webview_windows().values() {
        let _ = window.set_enabled(false);
    }
    let handle = app.handle().clone();
    app.dialog()
        .message(format!(
            "{error}\nYour local session files have been retained."
        ))
        .title("Scratchpad could not open")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}
pub fn run_event(app: &AppHandle, event: tauri::RunEvent) {
    if app.try_state::<StartupFailed>().is_some() {
        return;
    }
    match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if exit_approved(app) {
                return;
            }
            #[cfg(target_os = "windows")]
            if code.is_none() && window_entries(app).is_empty() {
                return;
            }
            api.prevent_exit();
            if code.is_none() && window_entries(app).is_empty() {
                return;
            }
            begin_quit(app);
        }
        tauri::RunEvent::WindowEvent { label, event, .. } => match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                begin_close(app, &label);
            }
            tauri::WindowEvent::Focused(_)
            | tauri::WindowEvent::Moved(_)
            | tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                update_metadata(app, &label);
                if matches!(event, tauri::WindowEvent::Focused(true)) {
                    let _ = rebuild_menu(app);
                }
            }
            _ => (),
        },
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if window_entries(app).is_empty() {
                menu_action(app, "new-window");
            } else if !has_visible_windows {
                if let Some(label) = active_label(app) {
                    focus_window(app, &label);
                }
            }
        }
        _ => (),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_embedded_index_navigation_is_allowed() {
        #[cfg(not(target_os = "windows"))]
        let allowed = ["tauri://localhost/index.html", "tauri://localhost/"];
        #[cfg(target_os = "windows")]
        let allowed = [
            "https://tauri.localhost/index.html",
            "https://tauri.localhost/",
        ];
        for url in allowed {
            assert!(allowed_navigation(&url.parse().unwrap()));
        }
        for url in [
            "https://example.com",
            "http://127.0.0.1:4260",
            "tauri://evil/index.html",
            "tauri://localhost/other.html",
            "file:///etc/passwd",
            "tauri://localhost/index.html?redirect=x",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap()));
        }
    }
    #[test]
    fn text_exports_are_bounded() {
        assert!(check_export("A small local note").is_ok());
        assert!(check_export(&"x".repeat(8 * 1024 * 1024 + 1)).is_err());
    }
}
