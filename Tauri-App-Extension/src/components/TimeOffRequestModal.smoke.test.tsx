import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeOffRequestModal } from "./TimeOffRequestModal";
import type { TimeOffBalance } from "../types";

const noop = () => {};

const policies: TimeOffBalance[] = [
  { policyId: "pol1", policyName: "Annual leave", balanceDays: 12.5, entitlementDays: 20 },
];

function render(overrides: Partial<Parameters<typeof TimeOffRequestModal>[0]> = {}) {
  return renderToStaticMarkup(
    <TimeOffRequestModal
      open
      policies={policies}
      policyId="pol1"
      startDate="2026-09-01"
      endDate="2026-09-03"
      note=""
      busy={false}
      error={null}
      onPolicyIdChange={noop}
      onStartDateChange={noop}
      onEndDateChange={noop}
      onNoteChange={noop}
      onCancel={noop}
      onSubmit={noop}
      {...overrides}
    />,
  );
}

describe("TimeOffRequestModal", () => {
  it("renders nothing when closed", () => {
    expect(render({ open: false })).toBe("");
  });

  it("lists the viewer's own policies by name", () => {
    expect(render()).toContain("Annual leave");
  });

  it("enables the request for a valid range", () => {
    expect(render()).not.toContain("disabled");
  });

  it("blocks and explains an end date before the start", () => {
    const html = render({ startDate: "2026-09-05", endDate: "2026-09-01" });
    expect(html).toContain("disabled");
    expect(html).toContain("can&#x27;t be before the start date");
  });

  it("blocks submitting without a policy", () => {
    expect(render({ policyId: "" })).toContain("disabled");
  });

  it("shows the busy label while sending", () => {
    expect(render({ busy: true })).toContain("Sending…");
  });
});
