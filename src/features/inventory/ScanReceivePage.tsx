import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  Camera,
  Upload,
  Check,
  X,
  Plus,
  AlertTriangle,
  Loader2,
  Package,
  ScanLine,
} from "lucide-react";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import { commitStockAdjust } from "../../lib/stockCommit";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import { ensureJpeg } from "../../utils/convertHeic";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import Spinner from "../../components/ui/Spinner";
import type { Item } from "../../types";

// ── Types ──

/** Raw item shape returned by the Cloud Function packing-slip parser. */
interface OcrParsedItem {
  name: string;
  matchedName: string | null;
  matchedItemId: string | null;
  size: string | null;
  qty: number;
  confidence: "high" | "medium" | "low";
}

/** Row in the editable items table. `source` distinguishes scan-extracted
 *  rows (used for the audit log + the conditional confidence column) from
 *  rows the user added manually via "Add Item". */
interface ScannedItem extends OcrParsedItem {
  source: "scan" | "manual";
}

type Stage = "review" | "confirm";

// ── Helpers ──

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Best-effort normalize an OCR-extracted date string to a YYYY-MM-DD
 * value the `<input type="date">` can display. Returns null on
 * unparseable input — the date input then renders blank and the user
 * can pick a date manually.
 */
function parseDateToISO(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function blankItemRow(): ScannedItem {
  return {
    name: "",
    matchedName: null,
    matchedItemId: null,
    size: null,
    qty: 1,
    confidence: "low",
    source: "manual",
  };
}

/** True if the rows array is just a single untouched default row (the
 *  initial bootstrap state). Used by `handleScan` to decide whether to
 *  replace existing rows with OCR results vs. append. */
function isDefaultEmptyState(rows: ScannedItem[]): boolean {
  if (rows.length !== 1) return false;
  const r = rows[0];
  return (
    r.source === "manual" &&
    !r.matchedItemId &&
    !r.name &&
    !r.size &&
    r.qty === 1
  );
}

function matchScannedItems(
  parsedItems: OcrParsedItem[],
  firestoreItems: Item[]
): ScannedItem[] {
  return parsedItems.map((item) => {
    let matchedItem: Item | undefined;

    if (item.matchedName) {
      matchedItem = firestoreItems.find(
        (i) => i.name.toLowerCase() === item.matchedName!.toLowerCase()
      );
    }

    if (!matchedItem) {
      matchedItem = firestoreItems.find(
        (i) =>
          i.name.toLowerCase().includes(item.name.toLowerCase()) ||
          item.name.toLowerCase().includes(i.name.toLowerCase())
      );
    }

    return {
      ...item,
      matchedItemId: matchedItem?.id ?? null,
      matchedName: matchedItem?.name ?? item.matchedName,
      source: "scan" as const,
    };
  });
}

const confidenceColors: Record<ScannedItem["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

// ── Component ──

export default function ScanReceivePage() {
  const navigate = useNavigate();
  const { logisticsUser } = useAuthContext();
  const { items: firestoreItems, loading: inventoryLoading } = useInventory();

  // Single unified flow: the page always lands on the Review form. The
  // "Scan Packing Slip" action is now a modal triggered from inside this
  // form rather than a separate page state — OCR results merge into the
  // existing items + form fields. The audit log distinguishes scan /
  // manual / mixed via per-item `source` flags aggregated at commit.
  const [stage, setStage] = useState<Stage>("review");

  // Scan modal state (was the previous "upload" stage). Lives independent
  // of `stage` so a successful scan returns to the same review screen.
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Review state. Bootstrap with one blank manual row + today's date so
  // the form is immediately usable; OCR-extracted rows merge in via the
  // scan modal.
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>(() => [
    blankItemRow(),
  ]);
  const [vendor, setVendor] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(() => todayISO());

  // Touched flags so a subsequent OCR scan doesn't overwrite values the
  // user has explicitly chosen. The today-default for `date` is treated
  // as untouched (touched only flips on user interaction).
  const [vendorTouched, setVendorTouched] = useState(false);
  const [dateTouched, setDateTouched] = useState(false);

  // Confirm state
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);

  // Drag-and-drop state
  const [dragging, setDragging] = useState(false);

  const validItems = useMemo(
    () => scannedItems.filter((si) => si.matchedItemId && si.qty > 0),
    [scannedItems]
  );

  // Drives the conditional Confidence column on the desktop table — the
  // column only appears once at least one OCR-extracted row exists.
  const hasScanItems = useMemo(
    () => scannedItems.some((si) => si.source === "scan"),
    [scannedItems]
  );

  // ── Handlers ──

  function handleFileSelect(file: File) {
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setScanError(null);
  }

  async function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Read off the synthetic event synchronously before the await — React
    // doesn't pool events in 19, but the input's value is reset whenever
    // the user picks again, so capture early.
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const safeFile = await ensureJpeg(file);
      handleFileSelect(safeFile);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Failed to convert image.",
      );
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    // Accept anything the browser tagged as image/* OR a HEIC/HEIF dropped
    // without a MIME (some Finder drops on older macOS arrive untyped).
    const lowerName = file.name.toLowerCase();
    const isHeicByName =
      lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
    if (!file.type.startsWith("image/") && !isHeicByName) return;
    try {
      const safeFile = await ensureJpeg(file);
      handleFileSelect(safeFile);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Failed to convert image.",
      );
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }

  async function handleScan() {
    if (!imageFile) return;
    setScanning(true);
    setScanError(null);

    try {
      const base64Data = await fileToBase64(imageFile);
      const parsePackingSlip = httpsCallable(
        getFunctions(),
        "parsePackingSlip"
      );
      const result = await parsePackingSlip({
        imageBase64: base64Data,
        mimeType: imageFile.type,
      });

      const data = result.data as {
        items: OcrParsedItem[];
        vendor?: string;
        date?: string;
      };

      const matched = matchScannedItems(data.items ?? [], firestoreItems);
      // Merge: if the table is just the bootstrap blank row, replace
      // outright; otherwise append so manual entries the user has
      // started aren't blown away.
      setScannedItems((prev) =>
        isDefaultEmptyState(prev) ? matched : [...prev, ...matched],
      );
      // Vendor + date fill ONLY if the user hasn't touched them. OCR
      // values normalized to YYYY-MM-DD; unparseable date → null and
      // the user enters it manually.
      if (!vendorTouched && data.vendor) {
        setVendor(data.vendor);
      }
      if (!dateTouched) {
        const parsed = parseDateToISO(data.date);
        if (parsed) setDate(parsed);
      }
      // Auto-close modal on success.
      setScanModalOpen(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to scan packing slip.";
      setScanError(message);
      // Modal stays open so the user can retry without re-uploading.
    } finally {
      setScanning(false);
    }
  }

  function handleRemoveRow(index: number) {
    setScannedItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUpdateItem(index: number, updates: Partial<ScannedItem>) {
    setScannedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  }

  function handleMatchChange(index: number, itemId: string) {
    const matched = firestoreItems.find((i) => i.id === itemId);
    handleUpdateItem(index, {
      matchedItemId: matched?.id ?? null,
      matchedName: matched?.name ?? null,
    });
  }

  function handleAddRow() {
    setScannedItems((prev) => [...prev, blankItemRow()]);
  }

  async function handleReceiveAll() {
    if (!logisticsUser || validItems.length === 0) return;
    if (!date) return;
    setCommitting(true);
    setCommitError(null);

    try {
      // Aggregate per-item provenance into an audit-log source: pure
      // scan, pure manual, or mixed when both contributed.
      const sourceSet = new Set(validItems.map((si) => si.source));
      const source: "scan" | "manual" | "mixed" =
        sourceSet.size > 1
          ? "mixed"
          : sourceSet.has("scan")
            ? "scan"
            : "manual";
      const notesPrefix =
        source === "scan"
          ? "[Packing Slip Scan]"
          : source === "manual"
            ? "[Manual Receive]"
            : "[Mixed Receive]";
      // Filter out blank parts so an empty vendor doesn't leave a
      // double space — produces e.g. "[Manual Receive] 2026-04-30"
      // when vendor is empty.
      const trimmedVendor = vendor?.trim();
      const notes = [notesPrefix, trimmedVendor, date]
        .filter((s): s is string => !!s && s.length > 0)
        .join(" ");
      const txId = await commitStockAdjust({
        actor: logisticsUser,
        type: "receive",
        items: validItems.map((si) => ({
          itemId: si.matchedItemId!,
          itemName: si.matchedName!,
          size: si.size ?? "one-size",
          qtyChange: si.qty,
          qtyBefore:
            firestoreItems.find((i) => i.id === si.matchedItemId)?.sizeMap?.[
              si.size ?? ""
            ]?.qty ?? 0,
        })),
        notes,
        source,
      });

      setTransactionId(txId);
      setReceivedCount(validItems.length);
      setStage("confirm");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to commit stock.";
      setCommitError(message);
    } finally {
      setCommitting(false);
    }
  }

  function handleReset() {
    // Re-bootstrap to the manual default (review stage, today's date,
    // one blank row). The "upload" stage no longer exists — scanning
    // happens via the modal triggered from inside the form.
    setStage("review");
    setImageFile(null);
    setImagePreviewUrl(null);
    setScannedItems([blankItemRow()]);
    setVendor(null);
    setDate(todayISO());
    setVendorTouched(false);
    setDateTouched(false);
    setScanError(null);
    setCommitError(null);
    setTransactionId(null);
    setReceivedCount(0);
    setScanModalOpen(false);
  }

  // Item-cell content shared between the mobile card layout and the
  // desktop table — either a matched-item badge with optional
  // manufacturer/model subtitle, or a manual-pick `<select>` for rows
  // Gemini couldn't auto-match. Defined inline (not as a sub-component)
  // because it captures `firestoreItems` and `handleMatchChange` from
  // the enclosing closure and isn't reused outside this page.
  const renderItemDisplay = (si: ScannedItem, idx: number) => {
    if (si.matchedItemId) {
      const subtitle = subtitleFromItem(
        firestoreItems.find((i) => i.id === si.matchedItemId),
      );
      return (
        <div>
          <span className="inline-block px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
            {si.matchedName}
          </span>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>
          )}
          {si.name && si.name !== si.matchedName && (
            <p className="text-xs text-slate-400 mt-1 truncate">
              OCR: {si.name}
            </p>
          )}
        </div>
      );
    }
    return (
      <div>
        <select
          value=""
          onChange={(e) => handleMatchChange(idx, e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-amber-300 bg-amber-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
        >
          <option value="" disabled>
            Select item...
          </option>
          {firestoreItems
            .filter((i) => i.isActive)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
        {si.name && (
          <p className="text-xs text-slate-400 mt-1 truncate">OCR: {si.name}</p>
        )}
      </div>
    );
  };

  // ── Render ──

  if (inventoryLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {stage === "review" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">Receive Stock</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setScanError(null);
                  setScanModalOpen(true);
                }}
              >
                <ScanLine className="h-4 w-4" />
                Scan Packing Slip
              </Button>
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <X className="h-4 w-4" />
                Start Over
              </Button>
            </div>
          </div>

          {/* Vendor + Date \u2014 required to commit. The today-default for
              date counts as untouched until the user changes it; OCR
              scans fill these only when the user hasn't typed. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-slate-500 mb-1">Vendor</span>
              <input
                type="text"
                value={vendor ?? ""}
                onChange={(e) => {
                  setVendor(e.target.value || null);
                  setVendorTouched(true);
                }}
                placeholder="Vendor / supplier"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-slate-500 mb-1">
                Date <span className="text-red-500">*</span>
              </span>
              <input
                type="date"
                value={date ?? ""}
                onChange={(e) => {
                  setDate(e.target.value || null);
                  setDateTouched(true);
                }}
                required
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
              />
            </label>
          </div>

          {/* Error banner */}
          {commitError && (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-medium text-red-800">{commitError}</p>
              <button
                onClick={() => setCommitError(null)}
                className="ml-auto text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="flex gap-6">
            {/* Left: image preview */}
            {imagePreviewUrl && (
              <div className="hidden lg:block w-64 flex-shrink-0">
                <div className="sticky top-6 border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <img
                    src={imagePreviewUrl}
                    alt="Packing slip"
                    className="w-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Right: items table */}
            <div className="flex-1 min-w-0">
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {/* Mobile (<sm): card-per-row. Item display + corner X
                    on top, then a single flex row with Size + Qty +
                    confidence badge. Inputs use `flex-1 min-w-0` so they
                    split the remaining space after the badge claims
                    its natural width. The table below is hidden at
                    this breakpoint. */}
                <div className="sm:hidden divide-y divide-slate-100">
                  {scannedItems.map((si, idx) => (
                    <div key={idx} className="relative p-4 space-y-3">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        aria-label="Remove row"
                        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <div className="pr-7">{renderItemDisplay(si, idx)}</div>
                      <div className="flex items-end gap-3">
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs text-slate-500 mb-1">
                            Size
                          </label>
                          <input
                            type="text"
                            value={si.size ?? ""}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                size: e.target.value || null,
                              })
                            }
                            aria-label="Size"
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="block text-xs text-slate-500 mb-1">
                            Qty
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={si.qty}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                qty: parseInt(e.target.value) || 0,
                              })
                            }
                            aria-label="Quantity"
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                          />
                        </div>
                        {/* Confidence badge only on scan-extracted rows;
                            manual rows would just show "low" (the
                            blank-row default), which is misleading
                            noise — render nothing instead. */}
                        {si.source === "scan" && (
                          <span
                            className={`shrink-0 inline-block px-2 py-0.5 text-xs font-medium rounded-full ${confidenceColors[si.confidence]}`}
                          >
                            {si.confidence}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop (sm+): full table. Confidence column only
                    appears once at least one scan-extracted row is in
                    the table — pure-manual receives keep the column
                    out so the table stays compact. */}
                <table className="hidden sm:table w-full text-sm table-fixed">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-medium text-slate-600">
                        Item
                      </th>
                      <th className="text-left px-2 py-3 font-medium text-slate-600 w-20">
                        Size
                      </th>
                      <th className="text-left px-2 py-3 font-medium text-slate-600 w-16">
                        Qty
                      </th>
                      {hasScanItems && (
                        <th className="text-left px-2 py-3 font-medium text-slate-600 w-24">
                          Confidence
                        </th>
                      )}
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {scannedItems.map((si, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          {renderItemDisplay(si, idx)}
                        </td>
                        <td className="px-2 py-3">
                          <input
                            type="text"
                            value={si.size ?? ""}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                size: e.target.value || null,
                              })
                            }
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                            placeholder="--"
                          />
                        </td>
                        <td className="px-2 py-3">
                          <input
                            type="number"
                            min={0}
                            value={si.qty}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                qty: parseInt(e.target.value) || 0,
                              })
                            }
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                          />
                        </td>
                        {hasScanItems && (
                          <td className="px-2 py-3">
                            {si.source === "scan" ? (
                              <span
                                className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${confidenceColors[si.confidence]}`}
                              >
                                {si.confidence}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-2 py-3">
                          <button
                            onClick={() => handleRemoveRow(idx)}
                            className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {scannedItems.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No items extracted. Add items manually below.
                  </div>
                )}
              </div>

              {/* Add row + Receive All */}
              <div className="flex items-center justify-between mt-4">
                <Button variant="ghost" size="sm" onClick={handleAddRow}>
                  <Plus className="h-4 w-4" />
                  Add Item
                </Button>

                <Button
                  onClick={handleReceiveAll}
                  disabled={
                    validItems.length === 0 || !date || committing
                  }
                  size="lg"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {committing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-5 w-5" />
                      Receive All ({validItems.length})
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage 3: Confirm */}
      {stage === "confirm" && (
        <div className="flex flex-col items-center justify-center py-16 space-y-6">
          <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full">
            <Check className="h-8 w-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-900">
              Stock Updated
            </h1>
            <p className="text-slate-500 mt-2">
              {receivedCount} item{receivedCount !== 1 ? "s" : ""} received into
              inventory.
            </p>
            {transactionId && (
              <p className="text-xs text-slate-400 mt-1 font-mono">
                Transaction: {transactionId}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => navigate("/logistics/inventory")}
            >
              Back to Inventory
            </Button>
            <Button onClick={handleReset}>
              <Camera className="h-4 w-4" />
              Scan Another
            </Button>
          </div>
        </div>
      )}

      {/* Scan Packing Slip modal — triggered from the Receive Stock
          form's heading. The drop zone, Take Photo / Upload, drag-drop,
          and submit button were the previous standalone "upload" stage;
          they now live here. On success, results merge into the form
          and the modal auto-closes; on error, the banner shows here so
          the user can retry without re-uploading. */}
      <Modal
        open={scanModalOpen}
        onClose={() => {
          setScanModalOpen(false);
          setScanError(null);
        }}
        title="Scan Packing Slip"
        subtitle="Take a photo or upload an image — extracted items will merge into the form."
        wide
      >
        <div className="space-y-5">
          {scanError && (
            <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">{scanError}</p>
              </div>
              <button
                onClick={() => setScanError(null)}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-xl transition-colors ${
              dragging
                ? "border-blue-400 bg-blue-50"
                : imagePreviewUrl
                  ? "border-slate-300 bg-white"
                  : "border-slate-300 bg-gray-50"
            }`}
          >
            {imagePreviewUrl ? (
              <div className="relative w-full h-full p-4">
                <img
                  src={imagePreviewUrl}
                  alt="Packing slip preview"
                  className="w-full h-full object-contain rounded-lg"
                />
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreviewUrl(null);
                  }}
                  className="absolute top-2 right-2 p-1 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-slate-50"
                >
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            ) : (
              <>
                <Camera className="h-10 w-10 text-slate-400 mb-4" />
                <div className="flex gap-3">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-navy-700 hover:bg-navy-800 rounded-lg transition-colors">
                      <Camera className="h-4 w-4" />
                      Take Photo
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleInputChange}
                      className="hidden"
                    />
                  </label>
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors">
                      <Upload className="h-4 w-4" />
                      Upload Image
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleInputChange}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                  or drag and drop an image here
                </p>
              </>
            )}
          </div>

          {scanning ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
              <p className="text-sm font-medium text-slate-600">
                Analyzing packing slip...
              </p>
            </div>
          ) : (
            <Button
              onClick={handleScan}
              disabled={!imageFile}
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Package className="h-5 w-5" />
              Scan Packing Slip
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
