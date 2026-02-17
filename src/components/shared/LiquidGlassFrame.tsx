import { useMemo, useRef } from "react";
import LiquidGlass from "liquid-glass-react";
import type { CSSProperties, ReactNode } from "react";
import { DEMO_BUTTON_PRESET, GLOBAL_LIQUID_PRESETS } from "@/config/liquidGlassPresets";
import { useUiStore } from "@/stores/uiStore";

interface LiquidGlassFrameProps {
  children: ReactNode;
  id?: string;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
  cornerRadius?: number;
  overLight?: boolean;
  dynamic?: boolean;
  interactive?: boolean;
}

export function LiquidGlassFrame(props: LiquidGlassFrameProps) {
  const {
    children,
    id,
    className = "",
    contentClassName = "",
    style,
    cornerRadius,
    overLight = false,
    dynamic = true,
    interactive = false,
  } = props;
  const liquidProfile = useUiStore((state) => state.liquidProfile);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const toolbarLike = className.includes("liquid-glass-toolbar-shell");

  // Only toolbar uses the full LiquidGlass runtime (small surface, single instance).
  // Cards always use the lightweight CSS static glass fill — the library's SVG
  // filter pipeline renders extra border/overlay elements (default 270×69) that
  // create visible artefacts on large panels, and mount/unmount causes flicker.
  const useLiquidRuntime = toolbarLike;

  const profilePreset = toolbarLike ? DEMO_BUTTON_PRESET : GLOBAL_LIQUID_PRESETS[liquidProfile];
  const activePreset = useMemo(() => {
    if (dynamic && toolbarLike) return profilePreset;
    return { ...profilePreset, elasticity: 0 };
  }, [dynamic, toolbarLike, profilePreset]);

  const resolvedCornerRadius = useMemo(() => {
    if (typeof cornerRadius === "number") return cornerRadius;
    if (className.includes("liquid-glass-toolbar-shell")) return 16;
    if (className.includes("liquid-glass-card-shell")) return 32;
    if (className.includes("liquid-glass-modal-shell")) return 16;
    return 16;
  }, [className, cornerRadius]);

  // ── Memoised glass layers ───────────────────────────────────────────
  // Locking the JSX reference prevents React reconciliation from touching
  // the cover / glass DOM nodes when only *children* change (button clicks,
  // text updates, etc.).  Untouched DOM ⇒ no compositor dirty-rect ⇒
  // Chromium never invalidates the backdrop-filter ⇒ zero flicker.
  const glassLayers = useMemo(
    () => (
      <>
        {/* Cover: stable backdrop-filter + solid-colour fallback.
            Even if Chromium briefly drops the filter the opaque background
            prevents the raw page content from flashing through. */}
        <div className="liquid-glass-cover" aria-hidden="true" />

        <div
          className={`liquid-glass-layer ${interactive ? "interactive" : ""}`.trim()}
          aria-hidden="true"
        >
          {useLiquidRuntime ? (
            <LiquidGlass
              className="liquid-glass-native"
              mode={activePreset.mode}
              displacementScale={activePreset.displacementScale}
              blurAmount={activePreset.blurAmount}
              saturation={activePreset.saturation}
              aberrationIntensity={activePreset.aberrationIntensity}
              elasticity={activePreset.elasticity}
              cornerRadius={resolvedCornerRadius}
              padding="0px"
              overLight={overLight}
              mouseContainer={dynamic ? frameRef : null}
              globalMousePos={dynamic ? undefined : { x: 0, y: 0 }}
              mouseOffset={dynamic ? undefined : { x: 0, y: 0 }}
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                top: "50%",
                left: "50%",
              }}
            >
              <span className="liquid-glass-native-fill" />
            </LiquidGlass>
          ) : (
            <div className="liquid-glass-static-fill" />
          )}
        </div>
      </>
    ),
    // frameRef identity is stable (useRef); only re-create when glass
    // config actually changes — children changes are excluded.
    [useLiquidRuntime, activePreset, resolvedCornerRadius, overLight, dynamic, interactive],
  );

  return (
    <div
      id={id}
      ref={frameRef}
      className={`liquid-glass-frame ${className}`.trim()}
      style={style}
    >
      {glassLayers}
      <div className={`liquid-glass-content ${contentClassName}`.trim()}>{children}</div>
    </div>
  );
}
