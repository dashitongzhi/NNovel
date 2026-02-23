import type { ReactNode } from "react";

interface ToolbarIconButtonProps {
  id?: string;
  title: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

export function ToolbarIconButton(props: ToolbarIconButtonProps) {
  const className = [
    "icon-btn",
    "toolbar-icon-btn",
    "glass-btn",
    props.className || "",
    props.active ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      id={props.id}
      className={className}
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={Boolean(props.disabled)}
      onMouseDown={(event) => {
        if (props.disabled) return;
        event.preventDefault();
        event.currentTarget.dataset.fastPressed = "1";
        props.onClick();
      }}
      onClick={(event) => {
        if (props.disabled) return;
        if (event.currentTarget.dataset.fastPressed === "1") {
          event.currentTarget.dataset.fastPressed = "";
          return;
        }
        props.onClick();
      }}
    >
      <span className="toolbar-icon-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: props.icon }} />
    </button>
  );
}

export function ToolbarItemIsolate(props: { children: ReactNode; className?: string }) {
  const className = props.className ? `toolbar-item-isolate ${props.className}` : "toolbar-item-isolate";
  return <span className={className}>{props.children}</span>;
}
