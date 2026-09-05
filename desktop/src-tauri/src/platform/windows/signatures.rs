//! Authenticode verification never performs certificate/revocation network retrieval.
use std::path::Path;
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::HWND,
        Security::{
            Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE},
            WinTrust::*,
        },
    },
};

pub fn verify_microsoft_offline(path: &Path) -> Result<(), String> {
    let wide = HSTRING::from(path.as_os_str());
    let mut file = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: windows::core::PCWSTR(wide.as_ptr()),
        ..Default::default()
    };
    let mut trust = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    unsafe {
        let code = WinVerifyTrust(
            HWND(std::ptr::null_mut()),
            &mut action,
            (&mut trust as *mut WINTRUST_DATA).cast(),
        );
        let valid = if code == 0 {
            let provider = WTHelperProvDataFromStateData(trust.hWVTStateData);
            if provider.is_null() {
                false
            } else {
                let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
                if signer.is_null()
                    || (*signer).csCertChain == 0
                    || (*signer).pasCertChain.is_null()
                {
                    false
                } else {
                    let certificate = (*(*signer).pasCertChain).pCert;
                    if certificate.is_null() {
                        false
                    } else {
                        let mut name = [0u16; 256];
                        let length = CertGetNameStringW(
                            certificate,
                            CERT_NAME_SIMPLE_DISPLAY_TYPE,
                            0,
                            None,
                            Some(&mut name),
                        );
                        length > 1
                            && length <= name.len() as u32
                            && String::from_utf16_lossy(&name[..length as usize - 1])
                                == "Microsoft Corporation"
                    }
                }
            }
        } else {
            false
        };
        trust.dwStateAction = WTD_STATEACTION_CLOSE;
        let _ = WinVerifyTrust(
            HWND(std::ptr::null_mut()),
            &mut action,
            (&mut trust as *mut WINTRUST_DATA).cast(),
        );
        if !valid {
            return Err(format!("The private WebView2 executable {} does not have a locally verifiable Microsoft signature (0x{:08x}). Repair Scratchpad using its trusted offline installer.", path.file_name().unwrap_or_default().to_string_lossy(), code as u32));
        }
    }
    Ok(())
}
