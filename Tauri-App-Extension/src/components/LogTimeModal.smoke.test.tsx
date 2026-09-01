import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogTimeModal } from "./LogTimeModal";
import type { ProjectInfo, TeamMemberStatus } from "../types";

const noop = () => {};

const projects: ProjectInfo[] = [
  { id: "p1", name: "Bana Test", projectType: "normal", hasTasks: true, requireTaskToTrack: true, requireStopNote: false, budgetExhausted: false, canCreateTasks: true },
];

const teammates: TeamMemberStatus[] = [
  { memberId: "t1", name: "Ada", trackingNow: false, onBreak: false, activeSecondsToday: 0 },
];

function render(overrides: Partial<Parameters<typeof LogTimeModal>[0]> = {}) {
  return renderToStaticMarkup(
    <LogTimeModal
      open
      projects={projects}
      teammates={[]}
      memberId=""
      projectId="p1"
      date="2026-09-01"
      hours="1.5"
      description=""
      busy={false}
      error={null}
      onMemberIdChange={noop}
      onProjectIdChange={noop}
      onDateChange={noop}
      onHoursChange={noop}
      onDescriptionChange={noop}
      onCancel={noop}
      onSave={noop}
      {...overrides}
    />,
  );
}

describe("LogTimeModal", () => {
  it("renders nothing when closed", () => {
    expect(render({ open: false })).toBe("");
  });

  it("enables Log time once a project, date and positive duration are set", () => {
    expect(render()).toContain("Log time");
    expect(render()).not.toContain("disabled");
  });

  it("blocks saving without a project", () => {
    expect(render({ projectId: "" })).toContain("disabled");
  });

  it("blocks saving on a zero or non-numeric duration", () => {
    expect(render({ hours: "0" })).toContain("disabled");
    expect(render({ hours: "" })).toContain("disabled");
    expect(render({ hours: "abc" })).toContain("disabled");
  });

  it("omits the member picker when the viewer leads no team - there is nobody else to pick", () => {
    const html = render();
    expect(html).not.toContain("log-time-member");
  });

  it("offers teammates plus Me once a roster is present", () => {
    const html = render({ teammates });
    expect(html).toContain("log-time-member");
    expect(html).toContain(">Me<");
    expect(html).toContain("Ada");
  });

  it("surfaces a server error without closing", () => {
    const html = render({ error: "This entry would put 9.0h on 2026-09-01, over this member's 8h daily limit." });
    expect(html).toContain("over this member&#x27;s 8h daily limit");
  });

  it("shows the busy label while saving", () => {
    expect(render({ busy: true })).toContain("Saving…");
  });
});
