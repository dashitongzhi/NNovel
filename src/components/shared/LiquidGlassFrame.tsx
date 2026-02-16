import { useCallback, useMemo, useRef } from "react";
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
  const activeGlassId = useUiStore((state) => state.activeGlassId);
  const setActiveGlassId = useUiStore((state) => state.setActiveGlassId);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const toolbarLike = className.includes("liquid-glass-toolbar-shell");
  const isCard = className.includes("liquid-glass-card-shell");

  // Toolbar: always use full LiquidGlass (small surface, single instance).
  // Cards: use full LiquidGlass only when THIS card is hovered.
  // This prevents 4+ large SVG filter pipelines (each ~150MB GPU textures)
  // from being mounted simultaneously, which crashes the render process.
  const frameId = id || className;
  const useLiquidRuntime = toolbarLike || (isCard && activeGlassId === frameId);

  const onMouseEnter = useCallback(() => {
    if (isCard) setActiveGlassId(frameId);
  }, [isCard, frameId, setActiveGlassId]);

  const onMouseLeave = useCallback(() => {
    if (isCard && activeGlassId === frameId) setActiveGlassId(null);
  }, [isCard, frameId, activeGlassId, setActiveGlassId]);

  const profilePreset = toolbarLike ? DEMO_BUTTON_PRESET : GLOBAL_LIQUID_PRESETS[liquidProfile];
  const activePreset = useMemo(() => {
    if (dynamic) return profilePreset;
    return { ...profilePreset, elasticity: 0 };
  }, [dynamic, profilePreset]);

  const resolvedCornerRadius = useMemo(() => {
    if (typeof cornerRadius === "number") return cornerRadius;
    if (className.includes("liquid-glass-toolbar-shell")) return 16;
    if (className.includes("liquid-glass-card-shell")) return 18;
    if (className.includes("liquid-glass-modal-shell")) return 16;
    return 16;
  }, [className, cornerRadius]);

  return (
    <div
      id={id}
      ref={frameRef}
      className={`liquid-glass-frame ${className}`.trim()}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`liquid-glass-layer ${interactive ? "interactive" : ""}`.trim()} aria-hidden="true">
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
      <div className={`liquid-glass-content ${contentClassName}`.trim()}>{children}</div>
    </div>
  );
}
