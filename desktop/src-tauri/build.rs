fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_load",
            "desktop_save",
            "desktop_rename",
            "desktop_ready",
            "desktop_flushed",
            "desktop_copy_text",
            "desktop_save_file",
        ]),
    ))
    .expect("failed to prepare the Scratchpad desktop application");
}
