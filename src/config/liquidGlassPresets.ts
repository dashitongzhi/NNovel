export type LiquidProfile = "balanced" | "aggressive" | "experimental";

export interface LiquidPreset {
  mode: "standard" | "polar" | "prominent" | "shader";
  displacementScale: number;
  blurAmount: number;
  saturation: number;
  aberrationIntensity: number;
  elasticity: number;
}

export const GLOBAL_LIQUID_PRESETS: Record<LiquidProfile, LiquidPreset> = {
  balanced: {
    mode: "standard",
    displacementScale: 46,
    blurAmount: 0.055,
    saturation: 136,
    aberrationIntensity: 1.2,
    elasticity: 0.08,
  },
  aggressive: {
    mode: "standard",
    displacementScale: 100,
    blurAmount: 0.5,
    saturation: 140,
    aberrationIntensity: 2,
    elasticity: 0,
  },
  experimental: {
    mode: "shader",
    displacementScale: 100,
    blurAmount: 0.5,
    saturation: 140,
    aberrationIntensity: 2,
    elasticity: 0,
  },
};

export const DEMO_CARD_PRESET: LiquidPreset = {
  mode: "standard",
  displacementScale: 100,
  blurAmount: 0.5,
  saturation: 140,
  aberrationIntensity: 2,
  elasticity: 0,
};

export const DEMO_BUTTON_PRESET: LiquidPreset = {
  mode: "standard",
  displacementScale: 64,
  blurAmount: 0.1,
  saturation: 130,
  aberrationIntensity: 2,
  elasticity: 0.35,
};
