import { useMemo, useRef } from "react";
import LiquidGlass from "liquid-glass-react";
import {
  DEMO_BUTTON_PRESET,
  DEMO_CARD_PRESET,
  GLOBAL_LIQUID_PRESETS,
  type LiquidProfile,
} from "@/config/liquidGlassPresets";

interface LiquidGlassShowcaseProps {
  profile: LiquidProfile;
}

export function LiquidGlassShowcase(props: LiquidGlassShowcaseProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePreset = useMemo(() => GLOBAL_LIQUID_PRESETS[props.profile], [props.profile]);

  return (
    <div
      ref={containerRef}
      className="liquid-showcase-root"
      style={{
        position: "relative",
        minHeight: 420,
        padding: 20,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid var(--border-color)",
        background:
          "radial-gradient(at 12% 8%, rgba(10,132,255,0.24), transparent 48%), radial-gradient(at 88% 92%, rgba(52,199,89,0.2), transparent 48%), linear-gradient(145deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "stretch" }}>
        <LiquidGlass
          mode={DEMO_CARD_PRESET.mode}
          displacementScale={DEMO_CARD_PRESET.displacementScale}
          blurAmount={DEMO_CARD_PRESET.blurAmount}
          saturation={DEMO_CARD_PRESET.saturation}
          aberrationIntensity={DEMO_CARD_PRESET.aberrationIntensity}
          elasticity={DEMO_CARD_PRESET.elasticity}
          cornerRadius={22}
          padding="22px"
          mouseContainer={containerRef}
          style={{ width: "100%", height: "100%", minHeight: 210, top: "unset", left: "unset", transform: "none", position: "relative" }}
        >
          <div style={{ color: "#fff", textShadow: "0 1px 1px rgba(0,0,0,.35)" }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>官方 Card 对齐</div>
            <div style={{ fontSize: 14, lineHeight: 1.65, opacity: 0.95 }}>
              displacement 70 · blur 0.0625 · saturation 140 · aberration 2 · elasticity 0.15
            </div>
          </div>
        </LiquidGlass>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, justifyContent: "center", alignItems: "center" }}>
          <LiquidGlass
            mode={DEMO_BUTTON_PRESET.mode}
            displacementScale={DEMO_BUTTON_PRESET.displacementScale}
            blurAmount={DEMO_BUTTON_PRESET.blurAmount}
            saturation={DEMO_BUTTON_PRESET.saturation}
            aberrationIntensity={DEMO_BUTTON_PRESET.aberrationIntensity}
            elasticity={DEMO_BUTTON_PRESET.elasticity}
            cornerRadius={100}
            padding="10px 22px"
            mouseContainer={containerRef}
            onClick={() => undefined}
            style={{ top: "unset", left: "unset", transform: "none", position: "relative" }}
          >
            <span style={{ color: "#fff", fontWeight: 700 }}>官方 Button 对齐</span>
          </LiquidGlass>

          <LiquidGlass
            mode={activePreset.mode}
            displacementScale={activePreset.displacementScale}
            blurAmount={activePreset.blurAmount}
            saturation={activePreset.saturation}
            aberrationIntensity={activePreset.aberrationIntensity}
            elasticity={activePreset.elasticity}
            cornerRadius={14}
            padding="12px 16px"
            mouseContainer={containerRef}
            style={{ top: "unset", left: "unset", transform: "none", position: "relative" }}
          >
            <span style={{ color: "#fff", fontWeight: 600 }}>当前全局档位：{props.profile}</span>
          </LiquidGlass>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {(["polar", "prominent", "shader"] as const).map((mode) => (
          <LiquidGlass
            key={mode}
            mode={mode}
            displacementScale={mode === "shader" ? 54 : 46}
            blurAmount={0.075}
            saturation={138}
            aberrationIntensity={1.6}
            elasticity={0.14}
            cornerRadius={14}
            padding="10px 12px"
            mouseContainer={containerRef}
            style={{ top: "unset", left: "unset", transform: "none", position: "relative", minHeight: 58 }}
          >
            <span style={{ color: "#fff", fontWeight: 700, textTransform: "capitalize" }}>{mode}</span>
          </LiquidGlass>
        ))}
      </div>
    </div>
  );
}