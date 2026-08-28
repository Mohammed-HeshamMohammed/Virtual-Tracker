import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StopNoteModal } from "./StopNoteModal";

const noop = () => {};

describe("StopNoteModal", () => {
  it("renders nothing when closed", () => {
    expect(
      renderToStaticMarkup(<StopNoteModal open={false} draft="" busy={false} onDraftChange={noop} onKeepTracking={noop} onStop={noop} />),
    ).toBe("");
  });

  it("disables Stop tracking until the draft has real content", () => {
    const empty = renderToStaticMarkup(
      <StopNoteModal open={true} draft="   " busy={false} onDraftChange={noop} onKeepTracking={noop} onStop={noop} />,
    );
    expect(empty).toContain("disabled");

    const withText = renderToStaticMarkup(
      <StopNoteModal open={true} draft="Called 3 leads" busy={false} onDraftChange={noop} onKeepTracking={noop} onStop={noop} />,
    );
    expect(withText).toContain("Stop tracking");
    expect(withText).toContain("Called 3 leads");
  });

  it("shows the busy label while stopping", () => {
    const html = renderToStaticMarkup(
      <StopNoteModal open={true} draft="note" busy={true} onDraftChange={noop} onKeepTracking={noop} onStop={noop} />,
    );
    expect(html).toContain("Stopping…");
  });
});
