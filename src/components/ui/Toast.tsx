import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, durationMs = DEFAULT_DURATION_MS) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (m, d) => push("success", m, d),
      error: (m, d) => push("error", m, d ?? 7000),
      info: (m, d) => push("info", m, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { kind, message } = toast;
  const styles: Record<ToastKind, { bg: string; border: string; text: string; Icon: typeof CheckCircle2 }> = {
    success: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800", Icon: CheckCircle2 },
    error: { bg: "bg-rose-50", border: "border-rose-300", text: "text-rose-800", Icon: AlertCircle },
    info: { bg: "bg-sky-50", border: "border-sky-300", text: "text-sky-800", Icon: Info },
  };
  const { bg, border, text, Icon } = styles[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2 ${bg} ${border} ${text} border rounded-lg shadow-md px-3 py-2 min-w-[240px] max-w-sm text-sm`}
    >
      <Icon size={16} className="shrink-0 mt-0.5" />
      <span className="flex-1 leading-snug">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 p-0.5 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
