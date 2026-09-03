import { Icon } from "./Icon";

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
