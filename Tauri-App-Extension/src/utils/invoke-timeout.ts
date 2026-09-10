/**
 * `invoke` with a deadline.
 *
 * A Tauri command's promise settles only when the Rust side returns. Every
 * command in this app funnels through one `Arc<Mutex<ApiClient>>` that the
 * tracker locks every five seconds across a whole HTTP round trip - so a slow
 * network could leave a command queued for tens of seconds, and a wedged one
 * left it pending forever.
 *
 * That was more than slow: `handleManualRefresh` sets a `refreshingData` latch
 * and clears it in a `finally`, with the refresh button disabled meanwhile. A
 * promise that never settles never runs the `finally`, so the button stayed
 * disabled and the guard on the first line swallowed every later click. The
 * refresh button simply stopped working until the app was restarted.
 *
 * A rejected promise is a far better outcome than a pending one: the latch
 * clears, the error surfaces, and the user can try again.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** Comfortably past the Rust side's own 15s HTTP timeout, so a request that is
 *  merely slow still gets to finish and report a real result. */
export const DEFAULT_INVOKE_TIMEOUT_MS = 25_000;

export class InvokeTimeoutError extends Error {
  constructor(command: string, ms: number) {
    super(`"${command}" did not respond within ${Math.round(ms / 1000)}s`);
    this.name = "InvokeTimeoutError";
  }
}

export function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_INVOKE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new InvokeTimeoutError(command, timeoutMs));
    }, timeoutMs);

    void tauriInvoke<T>(command, args)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}
