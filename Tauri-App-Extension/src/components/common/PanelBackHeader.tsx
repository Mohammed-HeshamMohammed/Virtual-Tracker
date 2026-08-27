import { Icon } from "./Icon";

/**
 * Back control on the same line as the heading it returns from.
 *
 * Replaces `.settings-back-row`, which spent 44px of vertical padding on a
 * single unlabeled chevron while the title bar directly above already named
 * the page. The control now carries a visible label, not just an aria-label.
 */
export function PanelBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="panel-back-header">
      <button className="btn-back" type="button" onClick={onBack}>
        <Icon name="chevron" className="icon-flip" />
        Back
      </button>
      <h2 className="panel-back-title">{title}</h2>
    </div>
  );
}
