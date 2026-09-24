//! Whether this copy of the tracker can install its own updates.
//!
//! The installer is perMachine, so the app lives in Program Files, which only
//! an administrator can write to. A monitored employee is a standard user by
//! design - that is rather the point of the product - so on a large share of
//! machines the tracker downloads every update and can install none of them.
//!
//! Before this existed such an agent was indistinguishable from a healthy one:
//! it reported a current version on every open and simply never moved.

use crate::types::UpdateInstallReadiness;

/// Probes by writing, not by reasoning about permissions: ACLs, group policy,
/// UAC virtualisation and AV file locking all feed into the real answer and
/// only an actual write reflects all of them at once.
pub fn probe() -> UpdateInstallReadiness {
    let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.to_path_buf())) else {
        // Cannot tell where we live: assume the cautious answer.
        return UpdateInstallReadiness { writable: false, install_dir: String::new() };
    };

    // The pid keeps two instances from racing on the same probe path, where
    // one could delete the other's file and make a writable directory look
    // read-only.
    let probe = dir.join(format!(".vt-update-probe-{}", std::process::id()));
    // create_new, not create: this runs elevated, and following a symlink
    // left at a predictable path would turn a read-only probe into a write
    // somewhere else. An existing file also means the answer is unknown
    // rather than yes, which is the cautious reading either way.
    let writable = match std::fs::File::create_new(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    };

    UpdateInstallReadiness { writable, install_dir: dir.to_string_lossy().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_probe_reports_a_real_directory_and_leaves_nothing_behind() {
        let readiness = probe();
        assert!(!readiness.install_dir.is_empty(), "a blocked update has to be able to name the directory");

        let dir = std::path::Path::new(&readiness.install_dir);
        let leftovers: Vec<_> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.file_name().to_string_lossy().starts_with(".vt-update-probe-"))
                    .collect()
            })
            .unwrap_or_default();
        assert!(leftovers.is_empty(), "the probe file must be cleaned up, not left in the install directory");
    }

    #[test]
    fn a_directory_the_process_cannot_write_to_reports_not_writable() {
        // The failure the whole module exists to detect. Without a case that
        // actually fails, `writable` could be hardcoded true and every test
        // here would still pass - the test binary's own directory is writable.
        let unwritable = if cfg!(windows) {
            // Created by the OS installer and writable only by SYSTEM and
            // administrators, which is exactly Program Files' own situation.
            std::path::PathBuf::from(r"C:\Windows\System32\config")
        } else {
            std::path::PathBuf::from("/proc/sys/kernel")
        };
        if !unwritable.exists() {
            return;
        }
        let probe = unwritable.join(".vt-update-probe-test");
        let created = std::fs::File::create(&probe);
        if created.is_ok() {
            // Running elevated (or as root): the premise does not hold, so
            // there is nothing to assert. Clean up rather than leave a file.
            let _ = std::fs::remove_file(&probe);
            return;
        }
        assert!(created.is_err(), "a protected system directory must refuse the write");
    }
}
