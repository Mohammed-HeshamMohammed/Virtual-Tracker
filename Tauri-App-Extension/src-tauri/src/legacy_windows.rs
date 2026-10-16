//! The SDK's static WebView2 loader imports EventSetInformation even on Windows 7.
//! Supply its import pointer locally so the Windows loader never requires that export.
//! Like Microsoft's TraceLoggingSetInformation, resolve it at runtime and return
//! ERROR_NOT_SUPPORTED when absent. Only optional ETW provider configuration is skipped.
//! https://learn.microsoft.com/windows/win32/api/traceloggingprovider/nf-traceloggingprovider-traceloggingsetinformation

use std::ffi::c_void;
use std::sync::OnceLock;

type EventSetInformationFn = unsafe extern "system" fn(u64, i32, *mut c_void, u32) -> u32;

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> Option<unsafe extern "system" fn()>;
}

// x86 uses stdcall decoration and the compiler adds a leading underscore,
// producing the SDK's __imp__EventSetInformation@20 import-pointer symbol.
// This is data (a function pointer), not a replacement DLL or an OS patch.
#[used]
#[cfg_attr(target_arch = "x86", export_name = "_imp__EventSetInformation@20")]
#[cfg_attr(not(target_arch = "x86"), export_name = "__imp_EventSetInformation")]
static EVENT_SET_INFORMATION_IMPORT: EventSetInformationFn = event_set_information;

unsafe extern "system" fn event_set_information(
    handle: u64,
    information_class: i32,
    information: *mut c_void,
    length: u32,
) -> u32 {
    static FUNCTION: OnceLock<Option<EventSetInformationFn>> = OnceLock::new();
    let function = *FUNCTION.get_or_init(|| {
        let name: Vec<u16> = "advapi32.dll\0".encode_utf16().collect();
        // The static loader also imports EventRegister from advapi32, so Windows
        // has already loaded this system module. Its lifetime is the process's.
        let module = unsafe { GetModuleHandleW(name.as_ptr()) };
        if module.is_null() {
            return None;
        }
        unsafe { GetProcAddress(module, c"EventSetInformation".as_ptr().cast()) }.map(
            |address| unsafe {
                // The export has the documented EventSetInformation signature
                // and system calling convention on both 32- and 64-bit Windows.
                std::mem::transmute::<unsafe extern "system" fn(), EventSetInformationFn>(address)
            },
        )
    });
    unsafe { call_event_set_information(function, handle, information_class, information, length) }
}

unsafe fn call_event_set_information(
    function: Option<EventSetInformationFn>,
    handle: u64,
    information_class: i32,
    information: *mut c_void,
    length: u32,
) -> u32 {
    match function {
        Some(function) => unsafe { function(handle, information_class, information, length) },
        None => 50, // ERROR_NOT_SUPPORTED, as used by TraceLogging on older Windows.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_export_returns_not_supported_without_touching_the_buffer() {
        let mut information = [1_u8, 2, 3];
        let result = unsafe {
            call_event_set_information(None, u64::MAX, 2, information.as_mut_ptr().cast(), 3)
        };
        assert_eq!(result, 50);
        assert_eq!(information, [1, 2, 3]);
    }

    #[test]
    fn available_export_receives_all_arguments_and_returns_its_status() {
        unsafe extern "system" fn system_function(
            handle: u64,
            information_class: i32,
            information: *mut c_void,
            length: u32,
        ) -> u32 {
            assert_eq!(handle, 0x1234_5678_9abc_def0);
            assert_eq!(information_class, 2);
            assert_eq!(length, 3);
            unsafe { *information.cast::<u8>() = 9 };
            87
        }

        let mut information = [1_u8, 2, 3];
        let result = unsafe {
            call_event_set_information(
                Some(system_function),
                0x1234_5678_9abc_def0,
                2,
                information.as_mut_ptr().cast(),
                3,
            )
        };
        assert_eq!(result, 87);
        assert_eq!(information, [9, 2, 3]);
    }
}
