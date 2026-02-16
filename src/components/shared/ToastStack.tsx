import { useUiStore } from "@/stores/uiStore";

export function ToastStack() {
  const toasts = useUiStore((s) => s.toasts);
  const layered = toasts.slice(-3);

  return (
    <div className="toast-layer-root" aria-live="polite" aria-atomic="true">
      {layered.map((toast, idx) => {
        const depth = layered.length - idx - 1;
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.type} toast-layer-item`}
            style={{
              zIndex: idx + 1,
              opacity: depth === 0 ? 1 : Math.max(0.55, 1 - depth * 0.2),
              transform: `translateY(${depth * 1.5}px) scale(${Math.max(0.96, 1 - depth * 0.015)})`,
            }}
          >
          {toast.message}
          </div>
        );
      })}
    </div>
  );
}

