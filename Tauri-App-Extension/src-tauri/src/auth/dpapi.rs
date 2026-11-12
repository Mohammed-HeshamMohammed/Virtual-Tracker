//! Windows DPAPI (CryptProtectData / CryptUnprotectData), bound to the signed-in Windows
//! user: only that user, on that machine, can read what `protect` writes.
//!
//! Used for the sign-in file `TokenStore` falls back to when Windows Credential Manager
//! refuses the credential - it caps a secret at 2560 bytes, and the sign-in is longer.

#[cfg(windows)]
pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let ok = CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output).is_ok();
        take_blob(ok, output)
    }
}

#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
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
        take_blob(ok, output)
    }
}

/// Copies DPAPI's output out and frees the buffer it allocated.
///
/// # Safety
/// `output` must be the blob a DPAPI call just filled in.
#[cfg(windows)]
unsafe fn take_blob(ok: bool, output: windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};

    if !ok || output.pbData.is_null() {
        return None;
    }
    let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
    let _ = LocalFree(HLOCAL(output.pbData as *mut core::ffi::c_void));
    Some(result)
}

/// No DPAPI off Windows: nothing is written unencrypted, so `TokenStore` keeps to the OS
/// keychain there (which has no comparable size limit).
#[cfg(not(windows))]
pub fn protect(_data: &[u8]) -> Option<Vec<u8>> {
    None
}

#[cfg(not(windows))]
pub fn unprotect(_data: &[u8]) -> Option<Vec<u8>> {
    None
}
