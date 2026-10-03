import { useEasyRead } from "../../utils/easyRead";

/** The A- / A+ buttons for Easy read's text size. Renders nothing in any other layout. */
export function EasyTextSize({ className }: { className?: string }) {
  const easy = useEasyRead();
  if (!easy.active) return null;
  return (
    <span className={`easy-size${className ? ` ${className}` : ""}`} role="group" aria-label="Text size">
      <button
        data-tip="Make the text smaller"
        type="button"
        className="easy-btn easy-btn-quiet"
        aria-label="Smaller text"
        disabled={!easy.canSmaller}
        onClick={easy.smaller}
      >
        A−
      </button>
      <button
        data-tip="Make the text larger"
        type="button"
        className="easy-btn easy-btn-quiet"
        aria-label="Larger text"
        disabled={!easy.canLarger}
        onClick={easy.larger}
      >
        A+
      </button>
    </span>
  );
}
