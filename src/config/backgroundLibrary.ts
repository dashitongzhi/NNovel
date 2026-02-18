export interface BackgroundItem {
  id: string;
  name: string;
  url: string;
}

// Keep default empty.
// Built-in backgrounds are loaded from backend at runtime (/api/background/library),
// which avoids Vite tracking every background asset and reloading on each image change.
export const DEFAULT_BACKGROUND_ID = "";
