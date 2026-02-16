import { useEffect, useMemo, useRef, useState } from "react";

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

export function ConfigSelect(props: ConfigSelectProps) {
  const { id, className = "config-input config-select-btn", value, options, onChange, placeholder = "", disabled = false } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const commitSelection = (nextValue: string) => {
    const trimmed = String(nextValue || "").trim();
    if (!trimmed) return;
    // Temporary debug: visible in default console level.
    console.log("[debug][ConfigSelect:select]", { id, from: value, to: trimmed });
    onChange(trimmed);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
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
      // Temporary debug: track auto-fallback selection correction.
      console.log("[debug][ConfigSelect:auto-fix]", { id, value, activeValue });
      onChange(activeValue);
    }
  }, [activeValue, onChange, value]);

  return (
    <div ref={rootRef} className="config-select">
      <button
        id={id}
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => {
          // Temporary debug: track menu open toggle.
          console.log("[debug][ConfigSelect:toggle]", { id, value, activeValue, disabled, open: !open });
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="config-select-label">{activeLabel}</span>
      </button>
      <div className={`config-select-menu glass-panel ${open ? "" : "hidden"}`}>
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
    </div>
  );
}
