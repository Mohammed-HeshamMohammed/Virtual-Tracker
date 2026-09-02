import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewTaskModal } from "./NewTaskModal";

const noop = () => {};

// The three fields added to match the web wizard's own set - every call
// site below spreads this so adding a field here doesn't mean touching
// every single test.
const extra = {
  description: "",
  priority: "medium",
  dueDate: "",
  onDescriptionChange: noop,
  onPriorityChange: noop,
  onDueDateChange: noop,
};

describe("NewTaskModal", () => {
  it("renders nothing when closed", () => {
    expect(
      renderToStaticMarkup(
        <NewTaskModal open={false} projectName="Bana Test" title="" estimateHours="" busy={false} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
      ),
    ).toBe("");
  });

  it("disables Create task until the title has real content", () => {
    const empty = renderToStaticMarkup(
      <NewTaskModal open={true} projectName="Bana Test" title="   " estimateHours="" busy={false} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
    );
    expect(empty).toContain("disabled");

    const withTitle = renderToStaticMarkup(
      <NewTaskModal open={true} projectName="Bana Test" title="Call the client" estimateHours="" busy={false} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
    );
    expect(withTitle).toContain("Create task");
    expect(withTitle).toContain("Call the client");
  });

  it("the estimate field is optional - present, but never gates Create task", () => {
    const html = renderToStaticMarkup(
      <NewTaskModal open={true} projectName="Bana Test" title="Call the client" estimateHours="4" busy={false} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
    );
    expect(html).toContain("Estimate (hours, optional)");
    expect(html).not.toContain("disabled");
  });

  it("names the project the task is being created in", () => {
    const html = renderToStaticMarkup(
      <NewTaskModal open={true} projectName="Bana Test" title="" estimateHours="" busy={false} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
    );
    expect(html).toContain("Bana Test");
  });

  it("shows the busy label while creating", () => {
    const html = renderToStaticMarkup(
      <NewTaskModal open={true} projectName="Bana Test" title="Call the client" estimateHours="" busy={true} error={null} onTitleChange={noop} onEstimateHoursChange={noop} onCancel={noop} onCreate={noop} {...extra} />,
    );
    expect(html).toContain("Creating…");
  });

  it("surfaces a create error (e.g. the server's own permission 403) without closing the dialog", () => {
    const html = renderToStaticMarkup(
      <NewTaskModal
        open={true}
        projectName="Bana Test"
        title="Call the client"
        estimateHours=""
        busy={false}
        error="Only project managers can create tasks for this project."
        onTitleChange={noop}
        onEstimateHoursChange={noop}
        onCancel={noop}
        onCreate={noop}
        {...extra}
      />,
    );
    expect(html).toContain("Only project managers can create tasks for this project.");
  });

  it("carries the three fields added to match the web wizard's own set", () => {
    const html = renderToStaticMarkup(
      <NewTaskModal
        open={true}
        projectName="Bana Test"
        title="Call the client"
        estimateHours=""
        busy={false}
        error={null}
        onTitleChange={noop}
        onEstimateHoursChange={noop}
        onCancel={noop}
        onCreate={noop}
        {...extra}
        description="Confirm the new billing address"
        dueDate="2026-09-10"
      />,
    );
    expect(html).toContain("Confirm the new billing address");
    expect(html).toContain("2026-09-10");
    // All four priority options present, current one selected.
    expect(html).toContain(">Low<");
    expect(html).toContain(">Urgent<");
    expect(html).toContain('value="medium" selected');
  });
});
