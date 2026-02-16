import type { CSSProperties, ReactNode } from "react";
import LiquidGlass from "liquid-glass-react";

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
    cornerRadius = 16,
    overLight = false,
    dynamic = false,
    interactive = false,
  } = props;

  const effectMode = "standard";

  return (
    <div id={id} className={`liquid-glass-frame ${className}`.trim()} style={style}>
      <LiquidGlass
        className="liquid-glass-native"
        cornerRadius={cornerRadius}
        mode={effectMode}
        overLight={overLight}
        padding="0"
        blurAmount={dynamic ? 0.068 : 0.05}
        displacementScale={dynamic ? 44 : 26}
        saturation={dynamic ? 136 : 124}
        aberrationIntensity={dynamic ? 1.15 : 0.35}
        elasticity={dynamic ? 0.1 : 0}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: interactive ? "auto" : "none",
          zIndex: 0,
        }}
      >
        <span className="liquid-glass-native-fill" />
      </LiquidGlass>
      <div className={`liquid-glass-content ${contentClassName}`.trim()}>{children}</div>
    </div>
  );
}
