import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EasyView } from "./EasyView";
import { resetEasyReadForTests, setEasyReadActive } from "../../utils/easyRead";
import type { AgentTask, ConnectionState, ProjectBudgetStatus, ProjectInfo } from "../../types";

const noop = () => {};

const project = (over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  id: "p1",
  name: "Bana Properties",
  projectType: "normal",
  hasTasks: true,
  requireTaskToTrack: true,
  requireStopNote: false,
  budgetExhausted: false,
  budgetSpentPercent: null,
  canCreateTasks: false,
  ...over,
});
const task: AgentTask = { id: "t1", title: "Call new leads", status: "open", projectId: "p1" };

const base = {
  projects: [project()],
  selectedProjectId: "p1",
  onSelectProject: noop,
  tasks: [task],
  selectedTaskId: "t1",
  onSelectTask: noop,
  taskRequired: true,
  tracking: false,
  paused: false,
  busy: false,
  seconds: 3725,
  projectBudget: null as ProjectBudgetStatus | null,
  dailyLimitHours: 8,
  workedTodaySeconds: 3725,
  startBlockedReason: "",
  connection: "connected" as ConnectionState,
  reconnecting: false,
  onReconnect: noop,
  wallClock: "2:02 PM",
  wallDate: "Tue, Sep 9",
  onStart: noop,
  onPause: noop,
  onResume: noop,
  onStop: noop,
  onOpenSettings: noop,
  onOpenProfile: noop,
  onOpenDashboard: noop,
};
const render = (over: Partial<typeof base> = {}) => renderToStaticMarkup(<EasyView {...base} {...over} />);

describe("EasyView", () => {
  it("shows the time worked, what you are working on, and a Start button", () => {
    const html = render();
    expect(html).toContain("01:02:05");
    expect(html).toContain("Bana Properties");
    expect(html).toContain("Call new leads");
    expect(html).toContain("Not tracking");
    expect(html).toContain("Start");
    expect(html).not.toContain("Stop");
  });

  it("offers Pause and Stop while tracking, and Resume and Stop on a break", () => {
    const tracking = render({ tracking: true });
    expect(tracking).toContain("Tracking");
    expect(tracking).toContain("Pause");
    expect(tracking).toContain("Stop");
    expect(tracking).not.toContain(">Start<");

    const paused = render({ paused: true });
    expect(paused).toContain("On a break");
    expect(paused).toContain("Resume");
    expect(paused).toContain("Stop");
  });

  it("locks the project and task pickers while a session is open, and says why", () => {
    const html = render({ tracking: true });
    expect(html).toContain("Stop the timer to change the project or task.");
    expect((html.match(/<select[^>]*disabled/g) ?? []).length).toBe(2);
  });

  it("disables Start and explains when it cannot start", () => {
    const html = render({ startBlockedReason: "Pick a task first", selectedTaskId: "" });
    expect(html).toContain("Pick a task first");
    expect(html).toMatch(/easy-btn-wide"[^>]*disabled/);
  });

  it("shows how much of the daily limit is left, and when it is reached", () => {
    expect(render()).toContain("left of your 8h daily limit");
    expect(render({ workedTodaySeconds: 8 * 3600 })).toContain("Daily limit reached");
    expect(render({ dailyLimitHours: 0 })).not.toContain("daily limit");
  });

  it("warns when the connection is lost, with a way to reconnect", () => {
    const html = render({ connection: "disconnected" });
    expect(html).toContain("Connection lost");
    expect(html).toContain("Reconnect");
    expect(render()).not.toContain("Connection lost");
  });

  it("does not ask for a task on a project that has none and does not need one", () => {
    const html = render({ tasks: [], selectedTaskId: "", taskRequired: false });
    expect(html).not.toContain("easy-label\">Task");
  });

  it("keeps the text size controls and the few places you can go", () => {
    // The size buttons follow the app-wide Easy read mode, which the layout switches on.
    resetEasyReadForTests();
    setEasyReadActive(true);
    const html = render();
    expect(html).toContain("Smaller text");
    expect(html).toContain("Larger text");
    expect(html).toContain("Settings");
    expect(html).toContain("Dashboard");
  });

  it("shows the project budget as one plain line, with when it resets", () => {
    const budget = { scope: "shared" as const, capSeconds: 36000, spentSeconds: 9000, remainingSeconds: 27000 };
    expect(render({ projectBudget: budget })).toContain("Project budget: 7h 30m left of 10h");
    expect(render({ projectBudget: { ...budget, resets: "monthly", periodEnd: "2026-11-14" } })).toContain("Resets Nov 15");
    expect(render({ projectBudget: { ...budget, remainingSeconds: 0, spentSeconds: 36000 } })).toContain("Project budget used up");
  });

  it("shows no budget line for a project without one", () => {
    expect(render({ projectBudget: null })).not.toContain("Project budget");
    expect(render({})).not.toContain("Project budget");
  });
});
