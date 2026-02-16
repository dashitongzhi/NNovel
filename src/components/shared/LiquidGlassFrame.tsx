import { useEffect, useMemo, useRef, useState } from "react";
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
  const [frameArea, setFrameArea] = useState(0);
  const forceStaticByRuntime = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    const gpuMode = String(params.get("gpu_mode") || "").toLowerCase();
    const gpuCompositing = String(params.get("gpu_compositing") || "").toLowerCase();
    const webgl = String(params.get("webgl") || "").toLowerCase();
    if (gpuMode === "software") return true;
    if (gpuCompositing.includes("disabled")) return true;
    if (webgl.includes("disabled")) return true;
    return false;
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;

    const updateArea = () => {
      const rect = el.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      setFrameArea(area);
    };

    updateArea();
    const ro = new ResizeObserver(updateArea);
    ro.observe(el);
    window.addEventListener("resize", updateArea);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateArea);
    };
  }, []);

  // Large panes are the common source of compositor instability (flicker/disappear).
  // We keep full liquid effect for small/medium widgets and use static glass for big surfaces.
  const staticSurface = forceStaticByRuntime || (!toolbarLike && frameArea >= 140000);
  const reducedSurface = !toolbarLike && frameArea >= 90000;
  const freezeMotion = forceStaticByRuntime || !dynamic || reducedSurface;
  const useLiquidRuntime = !staticSurface;

  const profilePreset = toolbarLike ? DEMO_BUTTON_PRESET : GLOBAL_LIQUID_PRESETS[liquidProfile];
  const activePreset = useMemo(() => {
    if (!freezeMotion) return profilePreset;
    return {
      ...profilePreset,
      displacementScale: Math.max(28, Math.round(profilePreset.displacementScale * 0.64)),
      blurAmount: Math.max(0.045, profilePreset.blurAmount),
      saturation: Math.max(128, profilePreset.saturation),
      aberrationIntensity: Math.max(0.85, profilePreset.aberrationIntensity * 0.56),
      elasticity: 0,
      mode: profilePreset.mode === "shader" ? "standard" : profilePreset.mode,
    };
  }, [freezeMotion, profilePreset]);

  const resolvedCornerRadius = useMemo(() => {
    if (typeof cornerRadius === "number") return cornerRadius;
    if (className.includes("liquid-glass-toolbar-shell")) return 16;
    if (className.includes("liquid-glass-card-shell")) return 18;
    if (className.includes("liquid-glass-modal-shell")) return 16;
    return 16;
  }, [className, cornerRadius]);

  return (
    <div id={id} ref={frameRef} className={`liquid-glass-frame ${className}`.trim()} style={style}>
      <div className={`liquid-glass-layer ${interactive ? "interactive" : ""} ${reducedSurface ? "safe-mode" : ""} ${staticSurface ? "static-mode" : ""}`.trim()} aria-hidden="true">
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
            mouseContainer={freezeMotion ? null : frameRef}
            globalMousePos={freezeMotion ? { x: 0, y: 0 } : undefined}
            mouseOffset={freezeMotion ? { x: 0, y: 0 } : undefined}
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
