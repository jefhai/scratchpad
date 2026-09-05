//! Product-owned, persistent Windows Filtering Platform policy.
//!
//! Only the elevated installer helper calls `prepare` / `install` / `remove`. Startup holds
//! `PolicyLock` until process exit and calls the read-only `audit` before creating
//! any WebView2 environment. No Windows Firewall profile, global WFP ACL, service,
//! or other product's policy is changed here. This is executable-attributed socket
//! denial, not a sandbox for OS brokers (DNS, cloud file providers, etc.).
//!
//! WFP contracts: https://learn.microsoft.com/windows/win32/fwp/object-management
//! https://learn.microsoft.com/windows/win32/fwp/access-control
//! https://learn.microsoft.com/windows/win32/fwp/filter-arbitration

use std::{
    collections::HashSet,
    ffi::{c_void, OsStr, OsString},
    fs::{self, File, OpenOptions},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Component, Path, PathBuf},
    ptr,
};
use windows::{
    core::{BOOL, GUID, PCWSTR, PWSTR},
    Win32::{
        Foundation::{
            CloseHandle, LocalFree, ERROR_NO_MORE_FILES, FWP_E_PROVIDER_NOT_FOUND,
            FWP_E_SUBLAYER_NOT_FOUND, HANDLE, HLOCAL, WAIT_OBJECT_0, WAIT_TIMEOUT,
        },
        NetworkManagement::WindowsFilteringPlatform::*,
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                GetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
            },
            CheckTokenMembership, CreateWellKnownSid, GetAce, IsValidAcl, IsValidSid,
            WinBuiltinAdministratorsSid, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
            DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
            SECURITY_MAX_SID_SIZE,
        },
        Storage::FileSystem::{
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        },
        System::{
            Com::CoTaskMemFree,
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Rpc::RPC_C_AUTHN_WINNT,
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            },
        },
        UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
    },
};

type Result<T = ()> = std::result::Result<T, String>;

pub const PROVIDER_KEY: GUID = GUID::from_u128(0xd1f0ae86_4d73_4a2b_9edf_1a849032bad8);
pub const SUBLAYER_KEY: GUID = GUID::from_u128(0x836f8926_05b6_487a_a5ec_626e88a3754a);
const FILTER_KEY_BASE: u128 = 0x7728fe1d_9433_4c9a_9e61_5bf900000000;
const POLICY_MARKER: &[u8] = b"Scratchpad.WFP.v1\0";
const LOCK_NAME: &str = "offline-policy.lock";
/// Startup must reject this marker while holding PolicyLock, before its audit.
/// Installer audits intentionally remain available while installation is marked.
pub const INSTALLING_MARKER: &str = ".scratchpad-installing";
const MAX_ENTRIES: usize = 16_384;
const MAX_EXECUTABLES: usize = 256;
const MAX_DEPTH: usize = 16;
const MAX_BLOB: usize = 1_048_576;
const MAX_PROCESSES: usize = 65_536;
const SUBLAYER_WEIGHT: u16 = u16::MAX;
const FILTER_WEIGHT: u64 = u64::MAX;
// A filter BLOCK is hard by default. Do not set CLEAR_ACTION_RIGHT, add a
// callout, or add any remote/local/loopback/profile/protocol exception.
const LAYERS: [GUID; 6] = [
    FWPM_LAYER_ALE_AUTH_CONNECT_V4,
    FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    FWPM_LAYER_ALE_AUTH_LISTEN_V4,
    FWPM_LAYER_ALE_AUTH_LISTEN_V6,
];

/// A cross-session/process lock; dropping the file releases the kernel lock.
/// Keep this in application state, not in a setup-local temporary.
pub struct PolicyLock {
    _file: File,
}

/// Return the only supported install location, obtained from Windows, not an
/// environment variable controlled by the caller.
fn standard_root() -> Result<PathBuf> {
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, None)
            .map_err(|e| format!("Cannot locate Program Files: {e}"))?;
        let value = PathBuf::from(OsString::from_wide(path.as_wide()));
        CoTaskMemFree(Some(path.0.cast()));
        Ok(value.join("Scratchpad"))
    }
}

/// Verify the exact protected installation root; junctions and symlinks are not
/// permitted, including on ancestors. Files must exist before policy installation.
pub fn validated_install_root(root: &Path) -> Result<PathBuf> {
    validate_root_spelling(root)?;
    let expected = standard_root()?;
    reject_reparse_ancestors(root)?;
    reject_reparse_ancestors(&expected)?;
    let actual = fs::canonicalize(root).map_err(|e| format!("Cannot resolve installation: {e}"))?;
    let expected = fs::canonicalize(&expected)
        .map_err(|e| format!("Cannot resolve standard installation: {e}"))?;
    if !same_path(&actual, &expected) || !actual.is_dir() {
        return Err(
            "Only the protected Program Files\\Scratchpad installation is supported.".into(),
        );
    }
    // A writable Program Files parent could replace a protected child directory.
    protected_acl(actual.parent().ok_or("Installation has no parent")?)?;
    protected_acl(&actual)?;
    Ok(actual)
}

/// Elevated preparation before NSIS copies or replaces ANY installed file. This
/// can run from the installer's private temporary helper and needs no app/runtime
/// files. The marker survives a failed or interrupted installer, blocking startup.
pub fn prepare(root: &Path) -> Result {
    validate_root_spelling(root)?;
    require_administrator()?;
    let expected = standard_root()?;
    let parent = expected
        .parent()
        .ok_or("Standard installation has no parent")?;
    let supplied_parent = root.parent().ok_or("Installation has no parent")?;
    reject_reparse_ancestors(parent)?;
    reject_reparse_ancestors(supplied_parent)?;
    let parent =
        fs::canonicalize(parent).map_err(|e| format!("Cannot resolve Program Files: {e}"))?;
    let supplied_parent = fs::canonicalize(supplied_parent)
        .map_err(|e| format!("Cannot resolve supplied installation parent: {e}"))?;
    if !same_path(&parent, &supplied_parent)
        || !root
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("Scratchpad"))
    {
        return Err(
            "Only the protected Program Files\\Scratchpad installation is supported.".into(),
        );
    }
    protected_acl(&parent)?;
    // Never create arbitrary parents, follow a missing-link destination, or create
    // the caller's unresolved path. Existing targets are validated below.
    match fs::create_dir(parent.join("Scratchpad")) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => {
            return Err(format!(
                "Cannot create standard installation directory: {e}"
            ))
        }
    }
    let root = validated_install_root(root)?;
    let _lock = acquire_lock(&root, true)?;
    ensure_quiescent(&root)?;
    mark_installing(&root)
}

fn require_administrator() -> Result {
    // The Administrators SID is deny-only in a normal UAC filtered token, so
    // membership must be enabled, not merely present in the process token.
    let mut sid_storage = [0_u32; SECURITY_MAX_SID_SIZE as usize / 4];
    let sid = PSID(sid_storage.as_mut_ptr().cast());
    let mut bytes = std::mem::size_of_val(&sid_storage) as u32;
    let mut enabled = BOOL::default();
    unsafe {
        CreateWellKnownSid(WinBuiltinAdministratorsSid, None, Some(sid), &mut bytes)
            .map_err(|e| format!("Cannot construct administrator identity: {e}"))?;
        CheckTokenMembership(None, sid, &mut enabled)
            .map_err(|e| format!("Cannot check installer elevation: {e}"))?;
    }
    if enabled.as_bool() {
        Ok(())
    } else {
        Err(
            "Policy preparation or modification requires an elevated administrator installer."
                .into(),
        )
    }
}

fn validate_root_spelling(root: &Path) -> Result {
    if !root.is_absolute()
        || root
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(
            "Scratchpad must be installed in the system Program Files\\Scratchpad directory."
                .into(),
        );
    }
    Ok(())
}

/// Called only while holding PolicyLock. Atomic creation makes even an empty
/// marker sufficient; startup never interprets marker contents. A pre-existing
/// regular protected marker indicates an interrupted operation and is preserved.
fn mark_installing(root: &Path) -> Result {
    let path = root.join(INSTALLING_MARKER);
    match OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(&path)
    {
        Ok(file) => file
            .sync_all()
            .map_err(|e| format!("Cannot persist installation marker: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("Cannot create installation marker: {e}")),
    }
    regular_protected_file(&path)
}

pub fn acquire_lock(root: &Path, allow_create: bool) -> Result<PolicyLock> {
    let root = validated_install_root(root)?;
    let path = root.join(LOCK_NAME);
    if allow_create {
        // create_new cannot follow/overwrite a pre-existing lock or reparse point.
        match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(&path)
        {
            Ok(file) => {
                file.sync_all()
                    .map_err(|e| format!("Cannot initialize policy lock: {e}"))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("Cannot create policy lock: {e}")),
        }
    }
    regular_protected_file(&path)?;
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(&path)
        .map_err(|e| {
            format!("Cannot open policy lock; close Scratchpad before repair/uninstall: {e}")
        })?;
    file.try_lock().map_err(|e| {
        format!("Scratchpad or its installer is already using this installation: {e}")
    })?;
    // Denying FILE_SHARE_DELETE additionally prevents replacement while held.
    Ok(PolicyLock { _file: file })
}

/// Enumerate every EXE in the installation (host, helper, uninstaller, runtime), bounded and
/// without following reparse points. Also protect DLL/data files against replacing
/// trusted code through a user-writable runtime directory.
pub fn expected_executables(root: &Path) -> Result<Vec<PathBuf>> {
    installed_executables(root, true)
}

fn installed_executables(root: &Path, require_runtime: bool) -> Result<Vec<PathBuf>> {
    let root = validated_install_root(root)?;
    let host = root.join("scratchpad.exe");
    if require_runtime {
        regular_protected_file(&host)?;
    }
    let runtime = root.join("webview2");
    let mut executables = Vec::new();
    let mut pending = vec![(root.clone(), 0_usize)];
    let mut count = 0_usize;
    let mut browser_found = false;
    while let Some((directory, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err("Private WebView2 directory exceeds the depth limit.".into());
        }
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|e| format!("Cannot inspect private runtime directory: {e}"))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 || !metadata.is_dir() {
            return Err(
                "Private WebView2 must contain ordinary protected directories only.".into(),
            );
        }
        protected_acl(&directory)?;
        for entry in fs::read_dir(&directory)
            .map_err(|e| format!("Cannot enumerate private runtime: {e}"))?
        {
            count += 1;
            if count > MAX_ENTRIES {
                return Err("Private WebView2 directory exceeds the entry limit.".into());
            }
            let path = entry
                .map_err(|e| format!("Cannot read runtime entry: {e}"))?
                .path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|e| format!("Cannot inspect runtime entry: {e}"))?;
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
                return Err("Private WebView2 cannot contain a reparse point.".into());
            }
            if metadata.is_dir() {
                pending.push((path, depth + 1));
            } else if metadata.is_file() {
                protected_acl(&path)?;
                if path
                    .extension()
                    .is_some_and(|x| x.eq_ignore_ascii_case("exe"))
                {
                    browser_found |= path.starts_with(&runtime)
                        && path
                            .file_name()
                            .is_some_and(|x| x.eq_ignore_ascii_case("msedgewebview2.exe"));
                    executables.push(path);
                    if executables.len() > MAX_EXECUTABLES {
                        return Err("Private WebView2 has too many executables.".into());
                    }
                }
            } else {
                return Err("Private WebView2 contains an unsupported file type.".into());
            }
        }
    }
    if require_runtime && !browser_found {
        return Err("The private fixed WebView2 runtime is missing msedgewebview2.exe.".into());
    }
    executables.sort_by_cached_key(|p| p.as_os_str().to_ascii_lowercase());
    for pair in executables.windows(2) {
        if same_path(&pair[0], &pair[1]) {
            return Err("Duplicate executable identity in private runtime.".into());
        }
    }
    Ok(executables)
}

/// A read-only process guard, called while PolicyLock excludes normal launches.
/// Orphan browser processes can outlive their host, so the host lock alone is not
/// evidence that the private runtime has stopped. No process is ever terminated.
fn ensure_quiescent(root: &Path) -> Result {
    // Include the pinned runtime's known names even during an empty/partial
    // installation. Inventory additionally covers every presently installed EXE.
    let mut names: HashSet<OsString> = [
        "scratchpad.exe",
        "scratchpad-policy.exe",
        "uninstall.exe",
        "msedgewebview2.exe",
        "notification_helper.exe",
        "platform_experiences_helper.exe",
        "elevated_tracing_service.exe",
        "mscopilot.exe",
        "copilotapp.exe",
        "copilotapphost.exe",
        "restartagent.exe",
        "copilot_setup.exe",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    for executable in installed_executables(root, false)? {
        if let Some(name) = executable.file_name() {
            names.insert(name.to_ascii_lowercase());
        }
    }
    let own_pid = std::process::id();
    // Two fresh bounded snapshots also catch a child published while an earlier
    // snapshot's exiting process was being inspected. This is a maintenance guard,
    // not a promise to contain processes launched independently by administrators.
    for _ in 0..2 {
        let processes = process_snapshot()?;
        for process in processes {
            if process.pid == own_pid || !names.contains(&process.name) {
                continue;
            }
            let handle = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    false,
                    process.pid,
                )
            };
            let handle = match handle {
                Ok(handle) => OwnedHandle(handle),
                Err(error) => {
                    // Access denied is not evidence of process exit. Confirm that
                    // this PID vanished in a new complete snapshot before skipping.
                    if !process_snapshot()?
                        .iter()
                        .any(|entry| entry.pid == process.pid)
                    {
                        continue;
                    }
                    return Err(format!("Cannot inspect a potentially active Scratchpad/runtime process (PID {}): {error}. Close the application and retry.", process.pid));
                }
            };
            if process_exited(&handle)? {
                continue;
            }
            let mut buffer = vec![0_u16; 32_768];
            let mut length = buffer.len() as u32;
            let queried = unsafe {
                QueryFullProcessImageNameW(
                    handle.0,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut length,
                )
            };
            if let Err(error) = queried {
                if process_exited(&handle)? {
                    continue;
                }
                return Err(format!("Cannot identify a potentially active Scratchpad/runtime process (PID {}): {error}. Policy was not changed.", process.pid));
            }
            if length == 0 || length as usize >= buffer.len() {
                return Err(
                    "Windows returned an invalid process image path; policy was not changed."
                        .into(),
                );
            }
            let image = PathBuf::from(OsString::from_wide(&buffer[..length as usize]));
            let canonical = match fs::canonicalize(&image) {
                Ok(path) => path,
                Err(error) => {
                    if process_exited(&handle)? {
                        continue;
                    }
                    return Err(format!("Cannot resolve a potentially active Scratchpad/runtime image (PID {}): {error}. Policy was not changed.", process.pid));
                }
            };
            if path_is_within(&canonical, root) && !process_exited(&handle)? {
                if process.name.eq_ignore_ascii_case("uninstall.exe") {
                    return Err("An in-place Scratchpad uninstaller is still running. Use the normal Windows Installed apps uninstall flow without NSIS in-place/self-copy bypass switches, then retry. Policy was not changed.".into());
                }
                return Err(format!("Scratchpad or its private runtime is still running (PID {}). Close it and retry; policy was not changed.", process.pid));
            }
        }
    }
    Ok(())
}

struct ProcessEntry {
    pid: u32,
    name: OsString,
}

fn process_snapshot() -> Result<Vec<ProcessEntry>> {
    let snapshot = OwnedHandle(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
            .map_err(|e| format!("Cannot inspect running processes: {e}"))?,
    );
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut next = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    let mut processes = Vec::new();
    loop {
        match next {
            Ok(()) => {}
            Err(error) if error.code() == ERROR_NO_MORE_FILES.to_hresult() => break,
            Err(error) => return Err(format!("Cannot complete process enumeration: {error}")),
        }
        if processes.len() >= MAX_PROCESSES {
            return Err(
                "Process enumeration exceeded its safety limit; policy was not changed.".into(),
            );
        }
        let length = entry
            .szExeFile
            .iter()
            .position(|&c| c == 0)
            .ok_or("Windows returned an unterminated process name")?;
        processes.push(ProcessEntry {
            pid: entry.th32ProcessID,
            name: OsString::from_wide(&entry.szExeFile[..length]).to_ascii_lowercase(),
        });
        next = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    if !processes
        .iter()
        .any(|process| process.pid == std::process::id())
    {
        return Err("Cannot verify a complete process snapshot; policy was not changed.".into());
    }
    Ok(processes)
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn process_exited(handle: &OwnedHandle) -> Result<bool> {
    match unsafe { WaitForSingleObject(handle.0, 0) } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => Ok(false),
        _ => {
            Err("Cannot verify whether a candidate process exited; policy was not changed.".into())
        }
    }
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path.ancestors().any(|ancestor| same_path(ancestor, root))
}

/// Elevated, atomic replacement of this product's complete policy. A failure
/// aborts the transaction, preserving any previously installed policy.
pub fn install(root: &Path) -> Result {
    require_administrator()?;
    let root = validated_install_root(root)?;
    let _lock = acquire_lock(&root, true)?;
    ensure_quiescent(&root)?;
    mark_installing(&root)?;
    let expected = Expected::new(&root)?;
    let engine = Engine::open()?;
    let transaction = Transaction::begin(&engine)?;
    remove_owned(&engine)?;
    let sd = LocalDescriptor::policy()?;
    let mut name = wide(OsStr::new("Scratchpad offline policy"))?;
    let mut provider_data = expected.manifest.clone();
    let provider = FWPM_PROVIDER0 {
        providerKey: PROVIDER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: PWSTR(name.as_mut_ptr()),
            ..Default::default()
        },
        flags: FWPM_PROVIDER_FLAG_PERSISTENT,
        providerData: borrowed_blob(&mut provider_data),
        // No service dependency: persistent objects should load whenever BFE does.
        serviceName: PWSTR::null(),
    };
    unsafe {
        status(
            FwpmProviderAdd0(engine.0, &provider, Some(sd.0)),
            "add provider",
        )?;
    }
    let mut provider_key = PROVIDER_KEY;
    let mut marker = POLICY_MARKER.to_vec();
    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: SUBLAYER_KEY,
        displayData: FWPM_DISPLAY_DATA0 {
            name: PWSTR(name.as_mut_ptr()),
            ..Default::default()
        },
        flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
        providerKey: &mut provider_key,
        providerData: borrowed_blob(&mut marker),
        weight: SUBLAYER_WEIGHT,
    };
    unsafe {
        status(
            FwpmSubLayerAdd0(engine.0, &sublayer, Some(sd.0)),
            "add sublayer",
        )?;
    }
    for (index, app_id) in expected.app_ids.iter().enumerate() {
        for (layer_index, layer) in LAYERS.iter().enumerate() {
            let mut app_blob = app_id.as_blob();
            let mut condition = app_condition(&mut app_blob);
            let mut weight = FILTER_WEIGHT;
            let filter = block_filter(
                filter_key(index, layer_index),
                *layer,
                &mut provider_key,
                &mut weight,
                &mut condition,
            );
            unsafe {
                status(
                    FwpmFilterAdd0(engine.0, &filter, Some(sd.0), None),
                    "add executable block filter",
                )?;
            }
        }
    }
    audit_expected(&engine, &expected)?;
    transaction.commit()?;
    // Reopen live BFE and reconstruct the inventory after commit. A successful
    // in-transaction check alone must never make an interrupted install runnable.
    audit(&root)?;
    let marker = root.join(INSTALLING_MARKER);
    regular_protected_file(&marker)?;
    fs::remove_file(&marker).map_err(|e| {
        format!("Policy is installed, but installation marker could not be cleared: {e}")
    })
}

/// Elevated and idempotent. Refuses while the application holds its lock. It does
/// not delete the lock file or any application/user data.
pub fn remove() -> Result {
    require_administrator()?;
    let root = validated_install_root(&standard_root()?)?;
    let _lock = acquire_lock(&root, false)?;
    ensure_quiescent(&root)?;
    mark_installing(&root)?;
    let engine = Engine::open()?;
    let transaction = Transaction::begin(&engine)?;
    remove_owned(&engine)?;
    transaction.commit()
}

/// Read-only, non-elevated startup check against live BFE objects. Caller must
/// already hold PolicyLock. This deliberately avoids global container enumeration
/// and read transactions, which ordinary users cannot perform by default.
pub fn audit(root: &Path) -> Result {
    let expected = Expected::new(root)?;
    let engine = Engine::open()?;
    audit_expected(&engine, &expected)
}

struct Expected {
    manifest: Vec<u8>,
    app_ids: Vec<AppId>,
}
impl Expected {
    fn new(root: &Path) -> Result<Self> {
        let executables = expected_executables(root)?;
        let mut manifest = POLICY_MARKER.to_vec();
        let mut app_ids = Vec::with_capacity(executables.len());
        manifest.extend_from_slice(&(executables.len() as u32).to_le_bytes());
        for path in executables {
            let app_id = AppId::new(&path)?;
            let bytes = app_id.bytes()?;
            manifest.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            manifest.extend_from_slice(bytes);
            if manifest.len() > MAX_BLOB {
                return Err("Executable policy manifest exceeds its size limit.".into());
            }
            app_ids.push(app_id);
        }
        Ok(Self { manifest, app_ids })
    }
}

fn filter_key(executable: usize, layer: usize) -> GUID {
    GUID::from_u128(FILTER_KEY_BASE | (executable * LAYERS.len() + layer + 1) as u128)
}

fn app_condition(blob: &mut FWP_BYTE_BLOB) -> FWPM_FILTER_CONDITION0 {
    FWPM_FILTER_CONDITION0 {
        fieldKey: FWPM_CONDITION_ALE_APP_ID,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: FWP_BYTE_BLOB_TYPE,
            Anonymous: FWP_CONDITION_VALUE0_0 { byteBlob: blob },
        },
    }
}

fn block_filter(
    key: GUID,
    layer: GUID,
    provider: &mut GUID,
    weight: &mut u64,
    condition: &mut FWPM_FILTER_CONDITION0,
) -> FWPM_FILTER0 {
    FWPM_FILTER0 {
        filterKey: key,
        displayData: FWPM_DISPLAY_DATA0 {
            name: PWSTR(
                windows::core::w!("Scratchpad: deny executable network access")
                    .0
                    .cast_mut(),
            ),
            ..Default::default()
        },
        flags: FWPM_FILTER_FLAG_PERSISTENT,
        providerKey: provider,
        layerKey: layer,
        subLayerKey: SUBLAYER_KEY,
        weight: FWP_VALUE0 {
            r#type: FWP_UINT64,
            Anonymous: FWP_VALUE0_0 { uint64: weight },
        },
        numFilterConditions: 1,
        filterCondition: condition,
        action: FWPM_ACTION0 {
            r#type: FWP_ACTION_BLOCK,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn audit_expected(engine: &Engine, expected: &Expected) -> Result {
    unsafe {
        let mut raw = ptr::null_mut();
        status(
            FwpmProviderGetByKey0(engine.0, &PROVIDER_KEY, &mut raw),
            "read offline provider; repair the installation",
        )?;
        let provider = WfpMemory::new(raw)?;
        let provider = &*provider.0;
        if provider.providerKey != PROVIDER_KEY
            || provider.flags != FWPM_PROVIDER_FLAG_PERSISTENT
            || !provider.serviceName.is_null()
            || blob_bytes(&provider.providerData)? != expected.manifest
        {
            return Err("Offline provider is disabled, changed, or does not match the installed executable inventory.".into());
        }
        let mut raw = ptr::null_mut();
        status(
            FwpmSubLayerGetByKey0(engine.0, &SUBLAYER_KEY, &mut raw),
            "read offline sublayer",
        )?;
        let sublayer = WfpMemory::new(raw)?;
        let sublayer = &*sublayer.0;
        if sublayer.subLayerKey != SUBLAYER_KEY
            || sublayer.providerKey.is_null()
            || *sublayer.providerKey != PROVIDER_KEY
            || sublayer.flags != FWPM_SUBLAYER_FLAG_PERSISTENT
            || sublayer.weight != SUBLAYER_WEIGHT
            || blob_bytes(&sublayer.providerData)? != POLICY_MARKER
        {
            return Err("Offline filtering sublayer does not match the required policy.".into());
        }
        for (index, app_id) in expected.app_ids.iter().enumerate() {
            for (layer_index, layer) in LAYERS.iter().enumerate() {
                let key = filter_key(index, layer_index);
                let mut raw = ptr::null_mut();
                status(
                    FwpmFilterGetByKey0(engine.0, &key, &mut raw),
                    "read executable block filter; repair the installation",
                )?;
                let filter = WfpMemory::new(raw)?;
                validate_filter(&*filter.0, &key, layer, app_id.bytes()?)?;
            }
        }
    }
    Ok(())
}

fn validate_filter(filter: &FWPM_FILTER0, key: &GUID, layer: &GUID, app_id: &[u8]) -> Result {
    // Reject unknown flags, including DISABLED, BOOTTIME, callout fallback, or
    // CLEAR_ACTION_RIGHT. Only the exact sole app-ID equality condition is valid.
    unsafe {
        if filter.filterKey != *key
            || filter.flags != FWPM_FILTER_FLAG_PERSISTENT
            || filter.providerKey.is_null()
            || *filter.providerKey != PROVIDER_KEY
            || filter.layerKey != *layer
            || filter.subLayerKey != SUBLAYER_KEY
            || filter.action.r#type != FWP_ACTION_BLOCK
            || filter.weight.r#type != FWP_UINT64
            || filter.weight.Anonymous.uint64.is_null()
            || *filter.weight.Anonymous.uint64 != FILTER_WEIGHT
            || filter.numFilterConditions != 1
            || filter.filterCondition.is_null()
            || filter.providerData.size != 0
            || !filter.reserved.is_null()
        {
            return Err("An executable's offline block filter was changed or disabled.".into());
        }
        let condition = &*filter.filterCondition;
        if condition.fieldKey != FWPM_CONDITION_ALE_APP_ID
            || condition.matchType != FWP_MATCH_EQUAL
            || condition.conditionValue.r#type != FWP_BYTE_BLOB_TYPE
            || condition.conditionValue.Anonymous.byteBlob.is_null()
            || blob_bytes(&*condition.conditionValue.Anonymous.byteBlob)? != app_id
        {
            return Err(
                "An executable's offline block filter is missing or has extra scope restrictions."
                    .into(),
            );
        }
    }
    Ok(())
}

fn remove_owned(engine: &Engine) -> Result {
    // NULL template means all filters, including other layers/old policy versions.
    // The owner GUID is checked before retaining a key for deletion. All reads and
    // deletes occur in our caller's write transaction, so the snapshot is stable.
    let mut handle = HANDLE::default();
    unsafe {
        status(
            FwpmFilterCreateEnumHandle0(engine.0, None, &mut handle),
            "enumerate owned policy",
        )?;
    }
    let enumeration = FilterEnumeration {
        engine: engine.0,
        handle,
    };
    let mut keys = Vec::new();
    let mut scanned = 0_usize;
    loop {
        let mut entries = ptr::null_mut();
        let mut count = 0_u32;
        unsafe {
            status(
                FwpmFilterEnum0(engine.0, enumeration.handle, 256, &mut entries, &mut count),
                "enumerate policy page",
            )?;
            let memory = if entries.is_null() {
                None
            } else {
                Some(WfpMemory::new(entries)?)
            };
            if count > 256 || (count != 0 && memory.is_none()) {
                return Err("BFE returned an invalid filter page.".into());
            }
            scanned += count as usize;
            if scanned > 1_000_000 {
                return Err("BFE filter enumeration exceeded its safety limit.".into());
            }
            if count != 0 {
                for &raw in std::slice::from_raw_parts(entries, count as usize) {
                    let filter = raw.as_ref().ok_or("BFE returned a null filter")?;
                    if !filter.providerKey.is_null() && *filter.providerKey == PROVIDER_KEY {
                        keys.push(filter.filterKey);
                    }
                }
            }
        }
        if count < 256 {
            break;
        }
    }
    drop(enumeration);
    unsafe {
        for key in keys {
            status(
                FwpmFilterDeleteByKey0(engine.0, &key),
                "delete owned block filter",
            )?;
        }
        let mut raw = ptr::null_mut();
        let code = FwpmSubLayerGetByKey0(engine.0, &SUBLAYER_KEY, &mut raw);
        if code != FWP_E_SUBLAYER_NOT_FOUND.0 as u32 {
            status(code, "inspect owned sublayer")?;
            let sublayer = WfpMemory::new(raw)?;
            if (*sublayer.0).providerKey.is_null() || *(*sublayer.0).providerKey != PROVIDER_KEY {
                return Err(
                    "The policy sublayer GUID is owned by another provider; nothing was removed."
                        .into(),
                );
            }
            status(
                FwpmSubLayerDeleteByKey0(engine.0, &SUBLAYER_KEY),
                "delete owned sublayer",
            )?;
        }
        let code = FwpmProviderDeleteByKey0(engine.0, &PROVIDER_KEY);
        if code != FWP_E_PROVIDER_NOT_FOUND.0 as u32 {
            status(code, "delete owned provider")?;
        }
    }
    Ok(())
}

struct Engine(HANDLE);
impl Engine {
    fn open() -> Result<Self> {
        let mut handle = HANDLE::default();
        unsafe {
            status(
                FwpmEngineOpen0(PCWSTR::null(), RPC_C_AUTHN_WINNT, None, None, &mut handle),
                "open live Base Filtering Engine (BFE must be running)",
            )?;
        }
        Ok(Self(handle))
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            let _ = FwpmEngineClose0(self.0);
        }
    }
}

struct Transaction<'a> {
    engine: &'a Engine,
    committed: bool,
}
impl<'a> Transaction<'a> {
    fn begin(engine: &'a Engine) -> Result<Self> {
        unsafe {
            status(
                FwpmTransactionBegin0(engine.0, 0),
                "begin policy transaction (administrator required)",
            )?;
        }
        Ok(Self {
            engine,
            committed: false,
        })
    }
    fn commit(mut self) -> Result {
        unsafe {
            status(
                FwpmTransactionCommit0(self.engine.0),
                "commit policy transaction",
            )?;
        }
        self.committed = true;
        Ok(())
    }
}
impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.committed {
            unsafe {
                let _ = FwpmTransactionAbort0(self.engine.0);
            }
        }
    }
}

struct FilterEnumeration {
    engine: HANDLE,
    handle: HANDLE,
}
impl Drop for FilterEnumeration {
    fn drop(&mut self) {
        unsafe {
            let _ = FwpmFilterDestroyEnumHandle0(self.engine, self.handle);
        }
    }
}

struct WfpMemory<T>(*mut T);
impl<T> WfpMemory<T> {
    fn new(raw: *mut T) -> Result<Self> {
        if raw.is_null() {
            Err("BFE returned an unexpectedly null object.".into())
        } else {
            Ok(Self(raw))
        }
    }
}
impl<T> Drop for WfpMemory<T> {
    fn drop(&mut self) {
        unsafe {
            let mut raw = self.0.cast::<c_void>();
            FwpmFreeMemory0(&mut raw);
        }
    }
}

struct AppId(WfpMemory<FWP_BYTE_BLOB>);
impl AppId {
    fn new(path: &Path) -> Result<Self> {
        let path = wide(path.as_os_str())?;
        let mut raw = ptr::null_mut();
        unsafe {
            status(
                FwpmGetAppIdFromFileName0(PCWSTR(path.as_ptr()), &mut raw),
                "resolve WFP executable identity",
            )?;
        }
        Ok(Self(WfpMemory::new(raw)?))
    }
    fn bytes(&self) -> Result<&[u8]> {
        unsafe { blob_bytes(&*self.0 .0) }
    }
    fn as_blob(&self) -> FWP_BYTE_BLOB {
        unsafe { *self.0 .0 }
    }
}

unsafe fn blob_bytes(blob: &FWP_BYTE_BLOB) -> Result<&[u8]> {
    if blob.size as usize > MAX_BLOB || (blob.size != 0 && blob.data.is_null()) {
        return Err("BFE returned an invalid policy byte blob.".into());
    }
    if blob.size == 0 {
        Ok(&[])
    } else {
        Ok(std::slice::from_raw_parts(blob.data, blob.size as usize))
    }
}
fn borrowed_blob(bytes: &mut [u8]) -> FWP_BYTE_BLOB {
    FWP_BYTE_BLOB {
        size: bytes.len() as u32,
        data: bytes.as_mut_ptr(),
    }
}

struct LocalDescriptor(PSECURITY_DESCRIPTOR);
impl LocalDescriptor {
    fn policy() -> Result<Self> {
        // Everyone receives only READ_CONTROL + FWPM_ACTRL_READ on OUR objects.
        // Neither mutation nor global enumeration/transaction rights are granted.
        let sddl = wide(OsStr::new(
            "O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x00020080;;;WD)",
        ))?;
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                PCWSTR(sddl.as_ptr()),
                SDDL_REVISION_1,
                &mut sd,
                None,
            )
            .map_err(|e| format!("Cannot construct policy access descriptor: {e}"))?;
        }
        Ok(Self(sd))
    }
}
impl Drop for LocalDescriptor {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(Some(HLOCAL(self.0 .0)));
        }
    }
}

fn protected_acl(path: &Path) -> Result {
    let name = wide(path.as_os_str())?;
    let mut owner = PSID::default();
    let mut dacl = ptr::null_mut::<ACL>();
    let mut sd = PSECURITY_DESCRIPTOR::default();
    unsafe {
        let code = GetNamedSecurityInfoW(
            PCWSTR(name.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            Some(&mut owner),
            None,
            Some(&mut dacl),
            None,
            &mut sd,
        );
        status(code.0, "read installation security")?;
        let _memory = LocalDescriptor(sd);
        if !trusted_sid(owner)? || dacl.is_null() || !IsValidAcl(dacl).as_bool() {
            return Err("Installation is not owned and protected by system administrators.".into());
        }
        for index in 0..(*dacl).AceCount as u32 {
            let mut raw = ptr::null_mut();
            GetAce(dacl, index, &mut raw)
                .map_err(|e| format!("Cannot inspect installation ACL: {e}"))?;
            let header = raw
                .cast::<ACE_HEADER>()
                .as_ref()
                .ok_or("Null installation ACE")?;
            if header.AceFlags & 0x08 != 0 {
                continue;
            } // INHERIT_ONLY_ACE does not apply here.
            match header.AceType {
                0 => {
                    if (header.AceSize as usize) < std::mem::size_of::<ACCESS_ALLOWED_ACE>() {
                        return Err("Invalid installation allow ACE.".into());
                    }
                    let ace = &*raw.cast::<ACCESS_ALLOWED_ACE>();
                    // File write/append/EA/delete-child/attributes, DELETE,
                    // WRITE_DAC/WRITE_OWNER, GENERIC_WRITE/GENERIC_ALL.
                    if ace.Mask & 0x500d_0156 != 0
                        && !trusted_sid(PSID(ptr::addr_of!(ace.SidStart).cast_mut().cast()))?
                    {
                        return Err("Installation permits non-administrator writes; repair its Program Files permissions.".into());
                    }
                }
                1 => {} // Deny ACEs never expand access.
                _ => return Err(
                    "Unsupported installation ACL; only ordinary allow/deny entries are supported."
                        .into(),
                ),
            }
        }
    }
    Ok(())
}

fn trusted_sid(sid: PSID) -> Result<bool> {
    unsafe {
        if sid.0.is_null() || !IsValidSid(sid).as_bool() {
            return Err("Invalid installation security identifier.".into());
        }
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(sid, &mut text)
            .map_err(|e| format!("Cannot inspect security identifier: {e}"))?;
        let value = text
            .to_string()
            .map_err(|e| format!("Invalid security identifier text: {e}"));
        let _ = LocalFree(Some(HLOCAL(text.0.cast())));
        Ok(matches!(
            value?.as_str(),
            "S-1-5-18"
                | "S-1-5-32-544"
                | "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
        ))
    }
}

fn regular_protected_file(path: &Path) -> Result {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Required installed file is unavailable: {e}"))?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err("Required installed files must not be symlinks or reparse points.".into());
    }
    protected_acl(path)
}
fn reject_reparse_ancestors(path: &Path) -> Result {
    for part in path.ancestors() {
        if part.as_os_str().is_empty() {
            continue;
        }
        let metadata =
            fs::symlink_metadata(part).map_err(|e| format!("Cannot inspect install path: {e}"))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Err("The installation path cannot traverse a symlink or reparse point.".into());
        }
    }
    Ok(())
}
fn same_path(left: &Path, right: &Path) -> bool {
    left.as_os_str().eq_ignore_ascii_case(right.as_os_str())
}
fn wide(value: &OsStr) -> Result<Vec<u16>> {
    let mut value: Vec<u16> = value.encode_wide().collect();
    if value.contains(&0) || value.len() > 32_000 {
        return Err("Invalid Windows path or policy string.".into());
    }
    value.push(0);
    Ok(value)
}
fn status(code: u32, action: &str) -> Result {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("Cannot {action}: Windows status 0x{code:08X}."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_path_scope_has_directory_boundaries() {
        let root = Path::new(r"C:\Program Files\Scratchpad");
        assert!(path_is_within(
            Path::new(r"C:\Program Files\Scratchpad\webview2\msedgewebview2.exe"),
            root
        ));
        assert!(path_is_within(
            Path::new(r"c:\program files\SCRATCHPAD\scratchpad.exe"),
            root
        ));
        assert!(!path_is_within(
            Path::new(r"C:\Program Files\Scratchpad-other\scratchpad.exe"),
            root
        ));
        assert!(!path_is_within(Path::new(r"C:\Temp\uninstall.exe"), root));
    }

    #[test]
    fn policy_keys_are_unique_and_bounded() {
        let mut seen = std::collections::HashSet::new();
        for executable in 0..MAX_EXECUTABLES {
            for layer in 0..LAYERS.len() {
                let key = filter_key(executable, layer);
                assert!(seen.insert(key));
                assert_ne!(key, PROVIDER_KEY);
                assert_ne!(key, SUBLAYER_KEY);
            }
        }
        assert_eq!(seen.len(), MAX_EXECUTABLES * 6);
    }

    #[test]
    fn filter_validation_rejects_relaxed_policy() {
        let mut bytes = vec![1_u8, 2, 0, 0];
        let expected = bytes.clone();
        let mut blob = borrowed_blob(&mut bytes);
        let mut condition = app_condition(&mut blob);
        let mut provider = PROVIDER_KEY;
        let mut weight = FILTER_WEIGHT;
        let key = filter_key(0, 0);
        let mut filter = block_filter(key, LAYERS[0], &mut provider, &mut weight, &mut condition);
        assert!(validate_filter(&filter, &key, &LAYERS[0], &expected).is_ok());
        filter.action.r#type = FWP_ACTION_PERMIT;
        assert!(validate_filter(&filter, &key, &LAYERS[0], &expected).is_err());
        filter.action.r#type = FWP_ACTION_BLOCK;
        filter.flags |= FWPM_FILTER_FLAG_DISABLED;
        assert!(validate_filter(&filter, &key, &LAYERS[0], &expected).is_err());
        filter.flags = FWPM_FILTER_FLAG_PERSISTENT;
        filter.numFilterConditions = 2;
        assert!(validate_filter(&filter, &key, &LAYERS[0], &expected).is_err());
        filter.numFilterConditions = 1;
        assert!(validate_filter(&filter, &key, &LAYERS[0], &[3, 4]).is_err());
    }

    #[test]
    fn no_wfp_calls_needed_for_input_validation() {
        assert!(wide(OsStr::new("a\0b")).is_err());
        assert!(validated_install_root(Path::new("relative\\Scratchpad")).is_err());
    }
}
