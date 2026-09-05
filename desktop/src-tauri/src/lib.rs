mod platform;
mod runtime;
mod session;

pub fn run() {
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        eprintln!("Scratchpad requires macOS 26+ on Apple silicon or Windows 11 x64.");
        return;
    }
    #[cfg(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64")
    ))]
    {
        let mut context = tauri::generate_context!();
        let prepared = match platform::before_runtime(&mut context) {
            Ok(prepared) => prepared,
            Err(error) => {
                platform::preflight_failed(&error);
                std::process::exit(1);
            }
        };
        let app = tauri::Builder::default()
            .manage(prepared)
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_clipboard_manager::init())
            .invoke_handler(tauri::generate_handler![
                runtime::desktop_load,
                runtime::desktop_save,
                runtime::desktop_rename,
                runtime::desktop_ready,
                runtime::desktop_flushed,
                runtime::desktop_copy_text,
                runtime::desktop_save_file,
            ])
            .setup(|app| {
                if let Err(error) = runtime::setup(app) {
                    runtime::startup_failed(app, error);
                }
                Ok(())
            })
            .on_menu_event(|app, event| runtime::menu_action(app, event.id().as_ref()))
            .build(context)
            .expect("Scratchpad could not initialize its local desktop workspace");
        app.run(runtime::run_event);
    }
}
