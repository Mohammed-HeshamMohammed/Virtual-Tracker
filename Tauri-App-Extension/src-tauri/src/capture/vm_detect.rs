//! AC-3: a device-level "might be a VM" signal, reported once at device
//! registration - never a verdict, never anything that blocks or alters
//! tracking. See the backend's `agent_devices.vm_detected` column: it is
//! surfaced to a manager alongside device ownership, weighed in context, not
//! auto-penalized (a false positive here is both wrong and, per the plan's
//! own warning, real legal exposure against a legitimate remote worker on a
//! VDI/cloud dev box). Deliberately lean, per the plan's "do not over-invest"
//! guidance: CPUID's hypervisor-present bit alone catches the overwhelming
//! majority of real cases and has essentially no false-negative risk (every
//! hypervisor, even a paravirtualized one with nothing else to fingerprint,
//! sets it) - driver-file checks are a cheap corroborating extra, not load-
//! bearing. ponytail: CPUID alone is the rung here.
//!
//! The Windows driver-file probe (vmmouse.sys, vboxguest.sys, ...) was
//! removed deliberately. It corroborated CPUID without adding reach - every
//! hypervisor sets the CPUID bit whether or not its guest tools are
//! installed - and scanning System32\drivers for hypervisor artifacts is a
//! textbook anti-analysis pattern. That matters here because AV engines
//! detonate samples *inside a VM*: the scanner watches the binary check
//! whether it is being analysed, which is one of the strongest heuristics
//! there is. Paying that for a corroborating signal on an advisory boolean
//! was a bad trade. See PLAN §13.3.

pub struct VmDetection {
    pub detected: bool,
    pub signals: Vec<String>,
}

/// CPUID leaf 1, ECX bit 31 - the hypervisor-present bit every hypervisor
/// sets on the guest's virtual CPU, regardless of what hardware it emulates.
/// The single most reliable, lowest-false-positive VM signal available.
#[cfg(target_arch = "x86_64")]
fn cpuid_hypervisor_signals() -> Vec<String> {
    use std::arch::x86_64::__cpuid;
    let mut signals = Vec::new();
    let leaf1 = __cpuid(1);
    if leaf1.ecx & (1 << 31) == 0 {
        return signals; // hypervisor bit clear - nothing else to check
    }
    signals.push("cpuid_hypervisor_bit".to_string());

    // Leaf 0x40000000: EBX/ECX/EDX spell out a 12-byte vendor ID string once
    // the hypervisor bit is set - every major hypervisor (VMware, VirtualBox,
    // Hyper-V, KVM, Xen, Parallels) publishes one.
    let leaf0 = __cpuid(0x4000_0000);
    let mut vendor = [0u8; 12];
    vendor[0..4].copy_from_slice(&leaf0.ebx.to_le_bytes());
    vendor[4..8].copy_from_slice(&leaf0.ecx.to_le_bytes());
    vendor[8..12].copy_from_slice(&leaf0.edx.to_le_bytes());
    let vendor_str = String::from_utf8_lossy(&vendor).trim().to_string();
    if !vendor_str.is_empty() {
        signals.push(format!("cpuid_vendor:{vendor_str}"));
    }
    signals
}

#[cfg(not(target_arch = "x86_64"))]
fn cpuid_hypervisor_signals() -> Vec<String> {
    Vec::new()
}

/// macOS-only signal: the kernel publishes whether it's running under a
/// hypervisor directly. Unverified on real macOS hardware - this codebase is
/// built and tested from Windows only (see `capture/activity.rs`'s
/// non-Windows `run_listeners` for the established precedent of flagging that
/// honestly rather than guessing silently) - but the command and its 0/1
/// output are Apple's own documented `sysctl` contract, not something this
/// crate has to reverse-engineer.
#[cfg(target_os = "macos")]
fn macos_hypervisor_signals() -> Vec<String> {
    use std::process::Command;
    match Command::new("sysctl").args(["-n", "kern.hv_vmm_present"]).output() {
        Ok(out) if out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "1" => {
            vec!["macos_hv_vmm_present".to_string()]
        }
        _ => Vec::new(),
    }
}

#[cfg(not(target_os = "macos"))]
fn macos_hypervisor_signals() -> Vec<String> {
    Vec::new()
}

/// Runs every signal check available on this platform and combines them into
/// one report. Called once at device registration, not per-tick - VM status
/// doesn't change mid-session.
pub fn detect_vm() -> VmDetection {
    let mut signals = cpuid_hypervisor_signals();
    signals.extend(macos_hypervisor_signals());
    VmDetection { detected: !signals.is_empty(), signals }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_vm_never_panics_and_detected_matches_whether_any_signal_fired() {
        let result = detect_vm();
        assert_eq!(result.detected, !result.signals.is_empty());
    }

    #[cfg(target_arch = "x86_64")]
    #[test]
    fn cpuid_check_never_panics_and_orders_the_bit_signal_first() {
        // Whether *this* machine is actually a VM is environment-dependent -
        // the only thing a unit test can assert either way is that it runs
        // cleanly and, if it does find the hypervisor bit, reports that
        // exact signal first.
        let signals = cpuid_hypervisor_signals();
        if !signals.is_empty() {
            assert_eq!(signals[0], "cpuid_hypervisor_bit");
        }
    }

}
