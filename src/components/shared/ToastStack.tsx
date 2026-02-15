import { useUiStore } from "@/stores/uiStore";

export function ToastStack() {
  const toasts = useUiStore((s) => s.toasts);
  const removeToast = useUiStore((s) => s.removeToast);

  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 4000, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`toast toast-${toast.type}`}
          onClick={() => removeToast(toast.id)}
          type="button"
          style={{ cursor: "pointer" }}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}

