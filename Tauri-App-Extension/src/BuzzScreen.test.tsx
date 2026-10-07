import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuzzView } from "./BuzzScreen";

const noop = () => {};

describe("BuzzView", () => {
  it("draws the joke blue screen with the message, who sent it, and how to close it", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "bluescreen", message: "Dude. Focus on work.", from: "Olive Owner" }} onClose={noop} />,
    );
    expect(html).toContain("buzz-bsod");
    expect(html).toContain("Dude. Focus on work.");
    expect(html).toContain("Olive Owner");
    expect(html).toContain("Just kidding");
    expect(html).toContain("Click anywhere or press any key");
  });

  it("draws the nudge as a card that is itself the close button", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "nudge", message: "Back to it", from: "Olive Owner" }} onClose={noop} />,
    );
    expect(html).toContain("buzz-nudge");
    expect(html).toContain("Buzz from Olive Owner");
    expect(html).toContain("Back to it");
    expect(html).not.toContain("buzz-bsod");
  });

  it("uses the tracker's own heading for its notices, such as a break ending", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "nudge", message: "Your timer is running again.", from: "", title: "Break is over" }} onClose={noop} />,
    );
    expect(html).toContain("Break is over");
    expect(html).not.toContain("Buzz from");
  });
});
