import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * Optional second line beneath the title. Renders with muted styling
   * (text-xs text-slate-500). When undefined or empty, the header renders
   * exactly as before — no layout shift for callers that don't pass it.
   */
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}

// Selector for focusable elements used by the Tab-key focus trap.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function Modal({ open, onClose, title, subtitle, children, wide }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Lock body scroll + manage focus while open.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog on next tick so the rendered children exist.
    const focusTimer = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? closeButtonRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // ESC to close + Tab-key focus trap.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("data-focus-skip"));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={`relative bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col ${wide ? "w-full max-w-3xl" : "w-full max-w-lg"}`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0 flex-1 mr-2">
            <h2 className="text-lg font-semibold text-slate-900 truncate">{title}</h2>
            {subtitle && (
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
