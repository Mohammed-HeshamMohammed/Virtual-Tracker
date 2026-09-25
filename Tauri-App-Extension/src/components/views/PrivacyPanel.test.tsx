// Drives the panel through real events in jsdom rather than only rendering it,
// because what matters here is what a click sends and what the member is told
// when it fails - a break that silently did nothing is the failure to prevent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CaptureStatus } from "../../types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("../../utils/invoke-timeout", () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("../../Toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() } }));

import { PrivacyPanel } from "./PrivacyPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_ON_BREAK: CaptureStatus = { blocked: false, reason: "", breakUntilMs: 0, issue: "" };
const ON_BREAK: CaptureStatus = { blocked: true, reason: "Private break - nothing is being captured.", breakUntilMs: Date.now() + 10 * 60_000, issue: "" };

const SUMMARY = { timezone: "UTC", screenshots: 4, appEvents: 9, apps: 3, domains: 2, activeSeconds: 3600 };
const RULE = { id: "e1", matchType: "domain", pattern: "mybank.com" };

let container: HTMLDivElement;
let root: Root;

function respond(overrides: Record<string, (args?: Record<string, unknown>) => unknown> = {}) {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (overrides[command]) return overrides[command](args);
    if (command === "get_my_capture_summary") return SUMMARY;
    if (command === "list_my_exclusions") return [RULE];
    return undefined;
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(status: CaptureStatus = NOT_ON_BREAK, extra: Partial<Parameters<typeof PrivacyPanel>[0]> = {}) {
  const onStatusChanged = vi.fn();
  await act(async () => {
    root.render(
      <PrivacyPanel status={status} timeZone="Africa/Cairo" onStatusChanged={onStatusChanged} onBack={() => {}} {...extra} />,
    );
  });
  await flush();
  return { onStatusChanged };
}

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const input = (label: string) => container.querySelector(`[aria-label="${label}"], #${label}`) as HTMLInputElement;

beforeEach(() => {
  invokeMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("loading", () => {
  it("asks for today's summary in the member's own time zone, and their own list", async () => {
    respond();
    await mount();
    expect(invokeMock).toHaveBeenCalledWith("get_my_capture_summary", { timeZone: "Africa/Cairo" });
    expect(invokeMock).toHaveBeenCalledWith("list_my_exclusions");
    expect(container.textContent).toContain("4 screenshots · 3 apps · 2 websites");
    expect(container.textContent).toContain("mybank.com");
  });

  it("says so when it cannot load, rather than staying on Loading forever", async () => {
    respond({
      get_my_capture_summary: () => Promise.reject(new Error("offline")),
      list_my_exclusions: () => Promise.reject(new Error("offline")),
    });
    await mount();
    expect(container.textContent).toContain("Could not load this right now.");
    expect(container.textContent).toContain("Could not load your list.");
    expect(container.textContent).not.toContain("Loading");
  });
});

describe("starting a private break", () => {
  it("cannot be started without a reason", async () => {
    respond();
    await mount();
    expect(button("Start break").disabled).toBe(true);
    type(input("break-reason"), "   ");
    expect(button("Start break").disabled).toBe(true);
    type(input("break-reason"), "Doctor");
    expect(button("Start break").disabled).toBe(false);
  });

  it("sends the chosen length and the trimmed reason, then refreshes the status", async () => {
    respond();
    const { onStatusChanged } = await mount();
    await click(button("30 min"));
    type(input("break-reason"), "  Doctor's appointment  ");
    await click(button("Start break"));
    expect(invokeMock).toHaveBeenCalledWith("set_private_break", { minutes: 30, reason: "Doctor's appointment" });
    expect(onStatusChanged).toHaveBeenCalled();
    expect((input("break-reason") as HTMLInputElement).value).toBe("");
  });

  it("defaults to the shortest break", async () => {
    respond();
    await mount();
    type(input("break-reason"), "Lunch");
    await click(button("Start break"));
    expect(invokeMock).toHaveBeenCalledWith("set_private_break", { minutes: 15, reason: "Lunch" });
  });

  it("tells the member the break started even though it could not be recorded", async () => {
    // The tracker stops capturing locally before it tries to record, so a failed
    // request leaves a break that is running. Saying nothing changed would be false.
    respond({ set_private_break: () => Promise.reject("You are offline") });
    const { onStatusChanged } = await mount();
    type(input("break-reason"), "Lunch");
    await click(button("Start break"));
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("started on this device");
    expect(alert?.textContent).toContain("You are offline");
    expect(onStatusChanged).toHaveBeenCalled();
  });
});

describe("ending a break", () => {
  it("shows the time left and an End break button instead of the start form", async () => {
    respond();
    await mount(ON_BREAK);
    expect(container.textContent).toMatch(/\d+ min left/);
    expect(button("End break")).toBeTruthy();
    expect(button("Start break")).toBeUndefined();
  });

  it("ends it by sending no minutes at all", async () => {
    respond();
    const { onStatusChanged } = await mount(ON_BREAK);
    await click(button("End break"));
    expect(invokeMock).toHaveBeenCalledWith("set_private_break", { minutes: null, reason: "" });
    expect(onStatusChanged).toHaveBeenCalled();
  });
});

describe("the member's own never-capture list", () => {
  it("adds a website and clears the box", async () => {
    respond({ add_my_exclusion: (args) => ({ id: "e2", matchType: args?.matchType, pattern: args?.pattern }) });
    await mount();
    type(container.querySelector('select[aria-label="Type"]') as HTMLSelectElement, "domain");
    type(input("Name"), "  https://www.other-bank.com/login ");
    await click(button("Add"));
    expect(invokeMock).toHaveBeenCalledWith("add_my_exclusion", {
      matchType: "domain",
      pattern: "https://www.other-bank.com/login",
    });
    expect(container.textContent).toContain("other-bank.com");
    expect((input("Name") as HTMLInputElement).value).toBe("");
  });

  it("puts the newest rule first", async () => {
    respond({ add_my_exclusion: () => ({ id: "e2", matchType: "app", pattern: "keepass" }) });
    await mount();
    type(input("Name"), "keepass");
    await click(button("Add"));
    const items = [...container.querySelectorAll(".privacy-item")].map((li) => li.textContent);
    expect(items[0]).toContain("keepass");
  });

  it("shows the server's own reason when an add is refused", async () => {
    respond({ add_my_exclusion: () => Promise.reject("You can exclude up to 100 items.") });
    await mount();
    type(input("Name"), "one-more");
    await click(button("Add"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("You can exclude up to 100 items.");
  });

  it("cannot add an empty name", async () => {
    respond();
    await mount();
    expect(button("Add").disabled).toBe(true);
    type(input("Name"), "   ");
    expect(button("Add").disabled).toBe(true);
  });

  it("removes a rule by id and drops it from the list", async () => {
    respond();
    await mount();
    await click(container.querySelector('[aria-label="Remove mybank.com"]')!);
    expect(invokeMock).toHaveBeenCalledWith("remove_my_exclusion", { id: "e1" });
    expect(container.textContent).not.toContain("mybank.com");
  });

  it("keeps a rule on screen when removing it failed", async () => {
    // Dropping it anyway would show the member as protected when they are not.
    respond({ remove_my_exclusion: () => Promise.reject("Not found") });
    await mount();
    await click(container.querySelector('[aria-label="Remove mybank.com"]')!);
    expect(container.textContent).toContain("mybank.com");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Not found");
  });
});
