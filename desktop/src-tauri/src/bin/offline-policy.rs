//! Installer-only policy maintenance. Never invoked by build scripts or the renderer.
#[cfg(target_os = "windows")]
#[path = "../platform/windows/policy.rs"]
mod policy;

fn main() {
    #[cfg(target_os = "windows")]
    {
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        let result = (|| {
            if args.len() != 2 {
                return Err("Usage: scratchpad-policy.exe prepare|install|audit|remove <ProgramFiles\\Scratchpad>".to_string());
            }
            if args[0] == "prepare" {
                return policy::prepare(std::path::Path::new(&args[1]));
            }
            let root = policy::validated_install_root(std::path::Path::new(&args[1]))?;
            match args[0].to_str() {
                Some("install") => policy::install(&root),
                Some("audit") => policy::audit(&root),
                Some("remove") => policy::remove(),
                _ => Err("Unknown policy operation.".into()),
            }
        })();
        match result {
            Ok(()) => println!("Scratchpad offline policy operation succeeded."),
            Err(error) => {
                eprintln!(
                    "Scratchpad offline policy: {}",
                    error.chars().take(2048).collect::<String>()
                );
                std::process::exit(1);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("Scratchpad's policy helper is Windows-only.");
        std::process::exit(1);
    }
}
