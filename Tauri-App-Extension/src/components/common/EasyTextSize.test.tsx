import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EasyTextSize } from "./EasyTextSize";
import { PanelBackHeader } from "./PanelBackHeader";
import { resetEasyReadForTests, setEasyReadActive, setEasyTextScaleIndex } from "../../utils/easyRead";

beforeEach(() => resetEasyReadForTests());

describe("EasyTextSize", () => {
  it("renders nothing in any other layout", () => {
    expect(renderToStaticMarkup(<EasyTextSize />)).toBe("");
  });

  it("offers smaller and larger text in Easy read, and disables each at its end", () => {
    setEasyReadActive(true);
    let html = renderToStaticMarkup(<EasyTextSize />);
    expect(html).toContain("Smaller text");
    expect(html).toContain("Larger text");
    expect(html).toMatch(/aria-label="Smaller text"[^>]*disabled|disabled[^>]*aria-label="Smaller text"/);
    setEasyTextScaleIndex(3);
    html = renderToStaticMarkup(<EasyTextSize />);
    expect(html).toMatch(/aria-label="Larger text"[^>]*disabled|disabled[^>]*aria-label="Larger text"/);
  });

  it("is in every panel's header, so Settings, Profile and Privacy all have it", () => {
    expect(renderToStaticMarkup(<PanelBackHeader title="Privacy" onBack={() => {}} />)).not.toContain("Larger text");
    setEasyReadActive(true);
    const html = renderToStaticMarkup(<PanelBackHeader title="Privacy" onBack={() => {}} />);
    expect(html).toContain("Privacy");
    expect(html).toContain("Larger text");
  });
});
