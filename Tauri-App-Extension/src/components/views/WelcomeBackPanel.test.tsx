// Regression coverage for the actual reported bug: a failed "Link this
// device again" (onRelink -> App.tsx's handleSignIn) writes its error into
// actionError, not reconnectMessage - this screen used to only ever read
// reconnectMessage, so that failure vanished into a toast and left the same
// generic text on screen with no persistent explanation. See App.tsx's
// message={reconnectMessage ?? actionError}.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeBackPanel } from "./WelcomeBackPanel";

const noop = () => {};
const baseProps = {
  profile: { signedIn: true, name: "Mohammed Hesham", avatarUrl: "", serverLabel: "" },
  busy: false,
  onReconnect: noop,
  onRelink: noop,
  onSwitchAccount: noop,
};

describe("WelcomeBackPanel message priority", () => {
  it("shows the specific message when one is passed, regardless of needsRelink", () => {
    const html = renderToStaticMarkup(
      <WelcomeBackPanel {...baseProps} message="Still can't reach the server. Check your connection and try again." needsRelink={false} />,
    );
    expect(html).toContain("Still can&#x27;t reach the server");
    expect(html).not.toContain("session went idle");
  });

  // The actual regression: simulating message={reconnectMessage ?? actionError}
  // with reconnectMessage null and actionError populated by a failed relink.
  it("falls back to a caller-supplied message even when it came from a different state slot", () => {
    const reconnectMessage: string | null = null;
    const actionError = "Sign-in is not ready yet. Reopen the agent and try again.";
    const html = renderToStaticMarkup(
      <WelcomeBackPanel {...baseProps} message={reconnectMessage ?? actionError} needsRelink={true} />,
    );
    expect(html).toContain("Sign-in is not ready yet");
    // Must not silently fall through to the generic "not linked" text just
    // because needsRelink is true - a real error was passed and must win.
    expect(html).not.toContain("no longer linked");
  });

  it("falls back to the generic not-linked text only when there is truly no message at all", () => {
    const html = renderToStaticMarkup(<WelcomeBackPanel {...baseProps} message={null} needsRelink={true} />);
    expect(html).toContain("no longer linked");
  });

  it("falls back to the idle-session text for a plain disconnect with no relink needed", () => {
    const html = renderToStaticMarkup(<WelcomeBackPanel {...baseProps} message={null} needsRelink={false} />);
    expect(html).toContain("session went idle");
  });

  it("shows 'Link this device again' only when needsRelink is true", () => {
    const relink = renderToStaticMarkup(<WelcomeBackPanel {...baseProps} message={null} needsRelink={true} />);
    expect(relink).toContain("Link this device again");

    const reconnect = renderToStaticMarkup(<WelcomeBackPanel {...baseProps} message={null} needsRelink={false} />);
    expect(reconnect).toContain("Continue as Mohammed");
    expect(reconnect).not.toContain("Link this device again");
  });
});
