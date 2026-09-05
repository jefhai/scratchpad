//! Platform boundaries. The shared workspace runtime never chooses an external origin.
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

pub struct Prepared {
    #[cfg(target_os = "windows")]
    windows: windows::Prepared,
}

/// Must run before Builder::build: Tauri probes the runtime before its setup callback.
pub fn before_runtime(context: &mut tauri::Context<tauri::Wry>) -> Result<Prepared, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(Prepared {
            windows: windows::before_runtime(context)?,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = context;
        Ok(Prepared {})
    }
}

pub fn preflight_failed(error: &str) {
    #[cfg(target_os = "windows")]
    windows::preflight_failed(error);
    #[cfg(not(target_os = "windows"))]
    eprintln!("Scratchpad could not open: {error}");
}

pub fn allowed_navigation(url: &tauri::Url) -> bool {
    embedded_index(url, cfg!(target_os = "windows"))
}

fn embedded_index(url: &tauri::Url, windows: bool) -> bool {
    let (scheme, host) = if windows {
        ("https", "tauri.localhost")
    } else {
        ("tauri", "localhost")
    };
    url.scheme() == scheme
        && url.host_str() == Some(host)
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "/" | "/index.html")
        && url.query().is_none()
}

pub fn prepare(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    windows::prepare(app)?;
    #[cfg(not(target_os = "windows"))]
    let _ = app;
    Ok(())
}

pub fn session_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    #[cfg(target_os = "windows")]
    let base = app.path().app_local_data_dir();
    #[cfg(not(target_os = "windows"))]
    let base = app.path().app_data_dir();
    let root = base.map_err(|error| error.to_string())?.join("sessions");
    #[cfg(target_os = "windows")]
    windows::validate_local_data_path(&root)?;
    Ok(root)
}

pub fn install_native_menu(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos::dock::install(app)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// Called only on Tauri's main thread, outside native/WebView2 event callbacks.
pub fn configure_builder<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> Result<tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>, String> {
    #[cfg(target_os = "windows")]
    {
        windows::configure_builder(builder)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(builder)
    }
}

pub fn finish_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    windows::finish_window(window)?;
    #[cfg(not(target_os = "windows"))]
    let _ = window;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_origins_are_disjoint_and_local() {
        for (windows, prefix) in [
            (true, "https://tauri.localhost"),
            (false, "tauri://localhost"),
        ] {
            assert!(embedded_index(
                &format!("{prefix}/index.html").parse().unwrap(),
                windows
            ));
            for suffix in ["/other.html", "/index.html?redirect=x", ":8899/index.html"] {
                assert!(!embedded_index(
                    &format!("{prefix}{suffix}").parse().unwrap(),
                    windows
                ));
            }
            for other in [
                "https://example.com/index.html",
                "https://tauri.localhost.evil/index.html",
                "http://tauri.localhost/index.html",
                "file:///index.html",
            ] {
                assert!(!embedded_index(&other.parse().unwrap(), windows));
            }
        }
        assert!(!embedded_index(
            &"tauri://localhost/index.html".parse().unwrap(),
            true
        ));
        assert!(!embedded_index(
            &"https://tauri.localhost/index.html".parse().unwrap(),
            false
        ));
    }
}
