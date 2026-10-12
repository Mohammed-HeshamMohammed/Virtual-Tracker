import type { ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { logos } from "../../brand";
import { WindowControls } from "../WindowControls";
import "./mode.css";

/** The title bar of the Focus and Easy windows: the Soft Fix mark, the mode's name, whatever
 *  buttons the mode wants, and the window buttons (without maximize, these windows are fixed
 *  shapes). Its empty space drags the window. */
export function ModeBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mode-bar" data-tauri-drag-region="deep">
      <span className="logo-crop logo-mark mode-bar-mark" aria-hidden="true">
        <img src={logos.mark} alt="" draggable={false} />
      </span>
      <strong className="mode-bar-title">{title}</strong>
      <div className="mode-bar-actions">{children}</div>
      {isTauri() && <WindowControls compact />}
    </header>
  );
}
