//! Windows DPAPI (CryptUnprotectData) - **read-only, migration-only**.
//!
//! MAC-1/F1: token storage moved to the OS credential store (Windows
//! Credential Manager / macOS Keychain / *nix Secret Service) via the
//! `keyring` crate - see `auth::tokens`. This file's only remaining job is
//! decrypting a pre-existing DPAPI-encrypted token file on first launch
//! after that migration, so an install that predates it doesn't get silently
//! signed out. `protect()` is gone entirely: nothing writes DPAPI anymore.
//!
//! Safe to delete this file in a future release once no install still has a
//! pre-migration file on disk to read.

#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    if data.is_empty() {
        return Some(Vec::new());
    }
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let ok = CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .is_ok();
        if !ok || output.pbData.is_null() {
            return None;
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
        Some(result)
    }
}

#[cfg(not(windows))]
pub fn unprotect(_data: &[u8]) -> Option<Vec<u8>> {
    None
}
