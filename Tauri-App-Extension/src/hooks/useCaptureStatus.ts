import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureStatus } from "../types";
import { EMPTY_CAPTURE_STATUS, sameCaptureStatus } from "../utils/privacy";

const POLL_MS = 5_000;

/**
 * Whether capture is on, and if not why. The answer is a local read - no network -
 * so polling it is cheap, and it has to be fresh: this is what tells a member their
 * break is running, or that the schedule has switched capture off.
 */
export function useCaptureStatus(enabled: boolean) {
  const [status, setStatus] = useState<CaptureStatus>(EMPTY_CAPTURE_STATUS);

  const refresh = useCallback(async () => {
    try {
      const next = await invoke<CaptureStatus>("capture_status");
      setStatus((prev) => (sameCaptureStatus(prev, next) ? prev : next));
    } catch {
      // Keeps the last known answer: a failed local read is not evidence that
      // capture has resumed, and clearing a break banner would say exactly that.
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus(EMPTY_CAPTURE_STATUS);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { status, refresh };
}
