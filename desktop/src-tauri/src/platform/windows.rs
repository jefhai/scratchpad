//! Windows 11 x64, protected private WebView2, and OS-enforced app-scoped offline policy.
//! No policy is installed here: absent/inaccessible policy is a startup error.
pub mod policy;
mod signatures;

use std::{
    cell::RefCell,
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
};
use tauri::Manager;
use webview2_com::{
    CoTaskMemPWSTR, CoreWebView2EnvironmentOptions, CreateCoreWebView2EnvironmentCompletedHandler,
    Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler,
};
use windows::{
    core::{w, Interface, HSTRING, PWSTR},
    Win32::{
        Foundation::{
            ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, E_POINTER, E_UNEXPECTED,
        },
        System::{
            Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
            Registry::*,
            SystemInformation::{OSVERSIONINFOEXW, OSVERSIONINFOW},
        },
        UI::Shell::GetCurrentProcessExplicitAppUserModelID,
    },
};

// COM interfaces are never declared Send/Sync or touched on worker threads.
thread_local! { static ENVIRONMENT: RefCell<Option<ICoreWebView2Environment>> = const { RefCell::new(None) }; }

pub struct Prepared {
    _lock: policy::PolicyLock,
    runtime: PathBuf,
}

pub fn preflight_failed(error: &str) {
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let message = HSTRING::from(format!(
        "{error}\nNo workspace was opened; local session files were not changed."
    ));
    unsafe {
        MessageBoxW(
            None,
            &message,
            w!("Scratchpad could not open"),
            MB_OK | MB_ICONERROR,
        );
    }
}

pub fn before_runtime(context: &mut tauri::Context<tauri::Wry>) -> Result<Prepared, String> {
    require_windows_11()?;
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    if exe.file_name().and_then(|name| name.to_str()) != Some("scratchpad.exe") {
        return Err("Use the installed Scratchpad application; moved or renamed executables are not supported.".into());
    }
    let root = policy::validated_install_root(
        exe.parent()
            .ok_or("The installed application folder is missing.")?,
    )?;
    // Read-only open still supports an exclusive OS file lock. Keep it until process exit.
    // Installation/uninstallation uses the same protected lock across policy transactions.
    if root.join(policy::INSTALLING_MARKER).exists() {
        return Err("Scratchpad installation is not complete. Finish or repair the installer before opening it.".into());
    }
    let lock = policy::acquire_lock(&root, false)?;
    if root.join(policy::INSTALLING_MARKER).exists() {
        return Err("Scratchpad installation is not complete. Finish or repair the installer before opening it.".into());
    }
    policy::audit(&root)?;
    reject_overrides(&context.config().identifier, None)?;
    let runtime = root.join("webview2");
    for path in policy::expected_executables(&root)? {
        if path.starts_with(&runtime) {
            signatures::verify_microsoft_offline(&path)?;
        }
    }
    if !matches!(&context.config().bundle.windows.webview_install_mode, tauri::utils::config::WebviewInstallMode::FixedRuntime { path } if path == Path::new("webview2"))
    {
        return Err("This executable was not built with the offline Windows configuration.".into());
    }
    // Pinned Tauri 2.11.5 injects this exact relative path into its own process
    // environment before probing WebView2. No fallback/shared runtime is permitted.
    Ok(Prepared {
        _lock: lock,
        runtime,
    })
}

pub fn prepare(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<super::Prepared>();
    let runtime = &state.windows.runtime;
    reject_overrides(&app.config().identifier, Some(runtime))?;
    // Crash reports remain local, extensions are off, and no Chromium feature flags are used
    // as an offline guarantee. WFP was verified before invoking any WebView2 loader API.
    let user_data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("webview2-local");
    validate_local_data_path(&user_data)?;
    fs::create_dir_all(&user_data)
        .map_err(|error| format!("Cannot create the local webview profile: {error}"))?;
    validate_local_data_path(&user_data)?;
    // The already-managed Prepared state retains its lock even if initialization fails.
    let environment = create_environment(runtime, &user_data)?;
    ENVIRONMENT.with(|slot| *slot.borrow_mut() = Some(environment));
    Ok(())
}

fn require_windows_11() -> Result<(), String> {
    let mut version = OSVERSIONINFOEXW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOEXW>() as u32,
        ..Default::default()
    };
    // RtlGetVersion is the documented version API, not manifest compatibility virtualization.
    let status = unsafe {
        windows::Wdk::System::SystemServices::RtlGetVersion(
            (&mut version as *mut OSVERSIONINFOEXW).cast::<OSVERSIONINFOW>(),
        )
    };
    if status.0 < 0
        || version.dwMajorVersion < 10
        || version.dwBuildNumber < 22000
        || version.wProductType != 1
    {
        return Err("Scratchpad requires Windows 11 x64 (workstation edition).".into());
    }
    Ok(())
}

pub fn validate_local_data_path(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;
    use std::path::{Component, Prefix};
    if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
    {
        return Err(
            "Automatic Scratchpad data must use a local drive, not a network/UNC profile.".into(),
        );
    }
    let drive = match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter,
            _ => unreachable!("prefix was checked above"),
        },
        _ => unreachable!("prefix was checked above"),
    };
    // A drive-letter spelling can still be a mapped network share. Query its type
    // before any filesystem traversal; permit removable/fixed/RAM local drives only.
    let drive_root = HSTRING::from(format!("{}:\\", drive as char));
    if !matches!(
        unsafe { windows::Win32::Storage::FileSystem::GetDriveTypeW(&drive_root) },
        2 | 3 | 6
    ) {
        return Err(
            "Automatic Scratchpad data cannot use a mapped network or unavailable drive.".into(),
        );
    }
    for parent in path.ancestors() {
        let metadata = match fs::symlink_metadata(parent) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Scratchpad's automatic local data cannot use a redirected or reparse-point folder.".into());
        }
    }
    Ok(())
}

fn reject_overrides(identifier: &str, tauri_runtime: Option<&Path>) -> Result<(), String> {
    // WebView2 gives environment/registry overrides precedence over explicit constructor args.
    // Fail closed without deleting/changing settings used by other applications.
    for (key, value) in std::env::vars_os() {
        if key.eq_ignore_ascii_case("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER") {
            if let Some(expected) = tauri_runtime {
                let actual = fs::canonicalize(Path::new(&value))
                    .map_err(|_| "Tauri's private runtime path is unavailable.".to_string())?;
                if actual
                    .as_os_str()
                    .eq_ignore_ascii_case(expected.as_os_str())
                {
                    continue;
                }
            }
        }
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("WEBVIEW2_")
        {
            return Err("WebView2 environment overrides are not permitted for offline Scratchpad. Launch from a clean desktop environment.".into());
        }
    }
    if std::env::args_os().len() != 1 {
        return Err("Scratchpad does not accept runtime paths, browser flags, or other command-line arguments.".into());
    }
    let mut app_ids = vec![
        "scratchpad.exe".to_string(),
        identifier.to_string(),
        "*".to_string(),
    ];
    if let Ok(id) = unsafe { GetCurrentProcessExplicitAppUserModelID() } {
        let id = CoTaskMemPWSTR::from(id).to_string();
        if !id.is_empty() {
            app_ids.push(id);
        }
    }
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            for setting in [
                "BrowserExecutableFolder",
                "UserDataFolder",
                "AdditionalBrowserArguments",
                "ChannelSearchKind",
                "ReleaseChannels",
            ] {
                let path = HSTRING::from(format!(
                    "Software\\Policies\\Microsoft\\Edge\\WebView2\\{setting}"
                ));
                let mut key = HKEY::default();
                let code =
                    unsafe { RegOpenKeyExW(hive, &path, None, KEY_QUERY_VALUE | view, &mut key) };
                if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
                    continue;
                }
                if code != ERROR_SUCCESS {
                    return Err(format!(
                        "Cannot verify the WebView2 {setting} policy: {code:?}."
                    ));
                }
                let result = (|| {
                    for app_id in &app_ids {
                        let name = HSTRING::from(app_id);
                        let mut length = 0;
                        let result = unsafe {
                            RegQueryValueExW(key, &name, None, None, None, Some(&mut length))
                        };
                        if result == ERROR_FILE_NOT_FOUND {
                            continue;
                        }
                        if result != ERROR_SUCCESS {
                            return Err(format!(
                                "Cannot inspect the WebView2 {setting} override: {result:?}."
                            ));
                        }
                        return Err(format!("A WebView2 {setting} policy overrides Scratchpad's private offline runtime. Ask the administrator to exclude Scratchpad; no shared policy was changed."));
                    }
                    Ok(())
                })();
                unsafe {
                    let _ = RegCloseKey(key);
                }
                result?;
            }
        }
    }
    Ok(())
}

fn create_environment(
    runtime: &Path,
    user_data: &Path,
) -> Result<ICoreWebView2Environment, String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| error.to_string())?;
    }
    let options = CoreWebView2EnvironmentOptions::default();
    let (sender, receiver) = mpsc::channel();
    unsafe {
        options.set_is_custom_crash_reporting_enabled(true);
        options.set_are_browser_extensions_enabled(false);
        options.set_exclusive_user_data_folder_access(true);
        CreateCoreWebView2EnvironmentWithOptions(
            &HSTRING::from(runtime.as_os_str()),
            &HSTRING::from(user_data.as_os_str()),
            &ICoreWebView2EnvironmentOptions::from(options),
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |status, environment| {
                    let result = status.and_then(|_| {
                        environment.ok_or_else(|| windows::core::Error::from(E_POINTER))
                    });
                    sender
                        .send(result)
                        .map_err(|_| windows::core::Error::from(E_UNEXPECTED))
                },
            )),
        )
        .map_err(|error| format!("Cannot load the protected private WebView2 runtime: {error}"))?;
    }
    webview2_com::wait_with_pump(receiver)
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("The private offline webview could not initialize: {error}"))
}

pub fn configure_builder<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> Result<tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, String> {
    ENVIRONMENT.with(|slot| {
        slot.borrow()
            .as_ref()
            .cloned()
            .map(|environment| builder.use_https_scheme(true).with_environment(environment))
            .ok_or("The verified offline environment is not available on this thread.".into())
    })
}

fn allowed_resource(uri: &str) -> bool {
    let Ok(url) = tauri::Url::parse(uri) else {
        return false;
    };
    url.scheme() == "https"
        && matches!(url.host_str(), Some("tauri.localhost" | "ipc.localhost"))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn finish_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    window
        .with_webview(move |platform| {
            let result = (|| -> windows::core::Result<()> {
                unsafe {
                    let core = platform.controller().CoreWebView2()?;
                    let settings = core.Settings()?;
                    settings
                        .cast::<ICoreWebView2Settings8>()?
                        .SetIsReputationCheckingRequired(false)?;
                    settings.SetAreDefaultContextMenusEnabled(false)?;
                    settings.SetAreDevToolsEnabled(false)?;
                    settings
                        .cast::<ICoreWebView2Settings3>()?
                        .SetAreBrowserAcceleratorKeysEnabled(false)?;
                    let environment = platform.environment();
                    core.cast::<ICoreWebView2_22>()?
                        .AddWebResourceRequestedFilterWithRequestSourceKinds(
                            w!("*"),
                            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                        )?;
                    let mut token = 0;
                    core.add_WebResourceRequested(
                        &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                            if let Some(args) = args {
                                let mut uri = PWSTR::null();
                                let request = args.Request()?;
                                let uri_result = request.Uri(&mut uri);
                                let uri = CoTaskMemPWSTR::from(uri);
                                if uri_result.is_err() || !allowed_resource(&uri.to_string()) {
                                    let response = environment.CreateWebResourceResponse(
                                        None::<&windows::Win32::System::Com::IStream>,
                                        403,
                                        w!("Offline workspace"),
                                        w!("Content-Type: text/plain\r\n"),
                                    )?;
                                    args.SetResponse(&response)?;
                                }
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    // WebView2 retains the callback until the controller is destroyed. It has no app state.
                    Ok(())
                }
            })()
            .map_err(|error| format!("The offline webview settings could not be applied: {error}"));
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    // This function is main-thread-only; Tauri's dispatcher runs with_webview inline there.
    receiver
        .try_recv()
        .map_err(|_| "Offline webview setup was not completed on the UI thread.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_filter_is_exact_not_suffix_or_loopback_permission() {
        assert!(allowed_resource("https://tauri.localhost/core/history.js"));
        assert!(allowed_resource(
            "https://ipc.localhost/plugin:event|listen"
        ));
        for uri in [
            "https://example.com",
            "http://tauri.localhost",
            "https://tauri.localhost.evil/file",
            "https://127.0.0.1/",
            "https://ipc.localhost:8080/",
            "file:///secret",
            "https://user:pass@tauri.localhost/",
        ] {
            assert!(!allowed_resource(uri), "{uri}");
        }
    }
}
