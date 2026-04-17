import { useState, useEffect, useCallback } from "react";

export default function ConnectionBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  const handleOnline = useCallback(() => {
    setOnline(true);
    setShowReconnected(true);
  }, []);

  const handleOffline = useCallback(() => {
    setOnline(false);
    setShowReconnected(false);
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  // Auto-hide the "Back online" banner after 2 seconds
  useEffect(() => {
    if (!showReconnected) return;
    const timer = setTimeout(() => setShowReconnected(false), 2000);
    return () => clearTimeout(timer);
  }, [showReconnected]);

  if (online && !showReconnected) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 text-center text-xs font-medium py-1 transition-colors ${
        online
          ? "bg-emerald-600 text-white"
          : "bg-amber-500 text-white"
      }`}
    >
      {online
        ? "Back online"
        : "You are offline. Changes won\u2019t be saved until you reconnect."}
    </div>
  );
}
