import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LayerPortal } from "@/components/shared/LayerPortal";

export interface ConfigSelectOption {
  value: string;
  label: string;
}

interface ConfigSelectProps {
  id?: string;
  className?: string;
  value: string;
  options: ConfigSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface MenuLayout {
  top: number;
  left: number;
  width: number;
}

export function ConfigSelect(props: ConfigSelectProps) {
  const { id, className = "config-input config-select-btn", value, options, onChange, placeholder = "", disabled = false } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);

  const commitSelection = (nextValue: string) => {
    const trimmed = String(nextValue || "").trim();
    if (!trimmed) return;
    onChange(trimmed);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuLayout(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPad = 12;
      const width = Math.max(152, Math.round(rect.width));
      const maxLeft = Math.max(viewportPad, window.innerWidth - viewportPad - width);
      const left = Math.max(viewportPad, Math.min(Math.round(rect.left), maxLeft));
      const top = Math.round(rect.bottom + 6);
      setMenuLayout({ top, left, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (event.target instanceof Node) {
        if (root && root.contains(event.target)) return;
        if (menu && menu.contains(event.target)) return;
      }
      setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: ConfigSelectOption[] = [];
    for (const item of options || []) {
      const v = String(item?.value ?? "").trim();
      const l = String(item?.label ?? "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      rows.push({ value: v, label: l || v });
    }
    return rows;
  }, [options]);

  const activeValue = normalizedOptions.some((x) => x.value === value) ? value : (normalizedOptions[0]?.value || "");
  const activeLabel = normalizedOptions.find((x) => x.value === activeValue)?.label || placeholder || "";

  useEffect(() => {
    if (!activeValue) return;
    if (activeValue !== value) {
      onChange(activeValue);
    }
  }, [activeValue, id, onChange, value]);

  const menuStyle: CSSProperties | undefined = menuLayout
    ? {
      position: "fixed",
      top: menuLayout.top,
      left: menuLayout.left,
      width: menuLayout.width,
      minWidth: menuLayout.width,
      maxWidth: menuLayout.width,
    }
    : undefined;

  return (
    <div ref={rootRef} className={`config-select${open ? " config-select-open" : ""}`}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="config-select-label">{activeLabel}</span>
      </button>

      {open ? (
        <LayerPortal>
          <div ref={menuRef} className="config-select-menu glass-panel" style={menuStyle}>
            {normalizedOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`config-select-option ${item.value === activeValue ? "active" : ""}`}
                data-value={item.value}
                onMouseDown={(event) => {
                  // Commit on mousedown so selection won't be lost if menu closes before click.
                  event.preventDefault();
                  event.stopPropagation();
                  commitSelection(item.value);
                }}
                onClick={(event) => {
                  // Fallback for environments where mousedown is suppressed.
                  event.preventDefault();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </LayerPortal>
      ) : null}
    </div>
  );
}
