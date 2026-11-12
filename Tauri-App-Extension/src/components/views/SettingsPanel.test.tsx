import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";

// The panel reads its state from the agent; this stands in for the agent's answer.
let autostartBlocked = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "get_app_settings") {
      return {
        version: "1.1.20",
        logPath: "C:\agent.log",
        autostartBlocked,
        preferences: {
          launchAtLogin: !autostartBlocked,
          startHidden: false,
          autoSignIn: true,
          closeToTray: true,
          layout: "auto",
          showInsights: true,
          captureScreen: "blurred",
          blurStrength: "medium",
          theme: "system",
        },
      };
    }
    throw new Error(`not mocked: ${command}`);
  }),
}));

const { SettingsPanel } = await import("./SettingsPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<SettingsPanel onBack={() => {}} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SettingsPanel - Launch at login", () => {
  it("says why, under the setting, when Windows refused to register it", async () => {
    autostartBlocked = true;
    await render();
    expect(container.textContent).toContain("Windows blocked this");
    expect(container.textContent).toContain("won't open by itself after a restart");
  });

  it("says nothing extra when it is registered", async () => {
    autostartBlocked = false;
    await render();
    expect(container.textContent).toContain("Launch at login");
    expect(container.textContent).not.toContain("Windows blocked this");
  });
});
