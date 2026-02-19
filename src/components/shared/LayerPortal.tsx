import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";

const UI_LAYER_ROOT_ID = "ui-layer-root";

function getOrCreateLayerRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let root = document.getElementById(UI_LAYER_ROOT_ID) as HTMLElement | null;
  if (root) return root;
  root = document.createElement("div");
  root.id = UI_LAYER_ROOT_ID;
  document.body.appendChild(root);
  return root;
}

interface LayerPortalProps {
  children: ReactNode;
}

export function LayerPortal(props: LayerPortalProps) {
  const root = useMemo(() => getOrCreateLayerRoot(), []);
  if (!root) return null;
  return createPortal(props.children, root);
}
