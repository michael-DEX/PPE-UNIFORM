import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw } from "lucide-react";

/**
 * Shown at the top of the viewport when a new service worker has been
 * installed and is waiting to activate. Two actions:
 *
 *   - "Reload"  → `updateServiceWorker(true)` — tells the waiting SW to
 *                 skipWaiting + reloads the page so the new bundle + SW
 *                 take control cleanly.
 *   - "Later"   → dismiss the banner for this session. The new SW stays
 *                 in its waiting state; the user gets the new code on
 *                 their next full page reload regardless.
 *
 * We also schedule a 1-hour `registration.update()` poll so a long-lived
 * tab keeps checking for newer deploys even if the user never navigates.
 *
 * This component is mounted once at the app root (outside router + auth
 * guards) and uses `position: fixed` so it overlays whatever's below.
 * It intentionally does NOT push page content down — the interruption is
 * temporary and pushing content would cause layout thrash in the middle
 * of whatever the user was doing (onboarding wizard, return sheet, etc.).
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[100] bg-blue-700 text-white text-sm px-4 py-2.5 flex items-center justify-between gap-3 shadow-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <RefreshCw size={14} aria-hidden="true" />
        <span className="truncate">A new version is available.</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-blue-100 hover:text-white text-xs px-2 py-1"
          aria-label="Dismiss update banner"
        >
          Later
        </button>
        <button
          onClick={() => updateServiceWorker(true)}
          className="bg-white text-blue-700 font-medium text-sm px-3 py-1 rounded min-h-8 hover:bg-blue-50 transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
