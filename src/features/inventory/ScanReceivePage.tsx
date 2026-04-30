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
} from "lucide-react";
import { useAuthContext } from "../../app/AuthProvider";
import { useInventory } from "../../hooks/useInventory";
import { commitStockAdjust } from "../../lib/stockCommit";
import { subtitleFromItem } from "../../lib/itemSubtitle";
import { ensureJpeg } from "../../utils/convertHeic";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import type { Item } from "../../types";

// ── Types ──

interface ScannedItem {
  name: string;
  matchedName: string | null;
  matchedItemId: string | null;
  size: string | null;
  qty: number;
  confidence: "high" | "medium" | "low";
}

type Stage = "upload" | "review" | "confirm";

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

function matchScannedItems(
  parsedItems: ScannedItem[],
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

  const [stage, setStage] = useState<Stage>("upload");

  // Upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Review state
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [vendor, setVendor] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

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
        items: ScannedItem[];
        vendor?: string;
        date?: string;
      };

      const matched = matchScannedItems(data.items ?? [], firestoreItems);
      setScannedItems(matched);
      setVendor(data.vendor ?? null);
      setDate(data.date ?? null);
      setStage("review");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to scan packing slip.";
      setScanError(message);
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
    setScannedItems((prev) => [
      ...prev,
      {
        name: "",
        matchedName: null,
        matchedItemId: null,
        size: null,
        qty: 1,
        confidence: "low",
      },
    ]);
  }

  async function handleReceiveAll() {
    if (!logisticsUser || validItems.length === 0) return;
    setCommitting(true);
    setCommitError(null);

    try {
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
        notes: `[Packing Slip Scan] ${vendor ?? ""} ${date ?? ""}`.trim(),
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
    setStage("upload");
    setImageFile(null);
    setImagePreviewUrl(null);
    setScannedItems([]);
    setVendor(null);
    setDate(null);
    setScanError(null);
    setCommitError(null);
    setTransactionId(null);
    setReceivedCount(0);
  }

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
      {/* Stage 1: Upload */}
      {stage === "upload" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Scan Packing Slip
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Take a photo or upload an image of your packing slip to
              automatically receive items into inventory.
            </p>
          </div>

          {/* Error banner */}
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

          {/* Drop zone */}
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

          {/* Scan button */}
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
      )}

      {/* Stage 2: Review */}
      {stage === "review" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Review Extracted Items
              </h1>
              {(vendor || date) && (
                <p className="text-sm text-slate-500 mt-1">
                  {vendor && <span className="font-medium">{vendor}</span>}
                  {vendor && date && " \u00b7 "}
                  {date && <span>{date}</span>}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <X className="h-4 w-4" />
              Start Over
            </Button>
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-medium text-slate-600">
                        Item
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 w-28">
                        Size
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 w-20">
                        Qty
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 w-24">
                        Confidence
                      </th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {scannedItems.map((si, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        {/* Item column */}
                        <td className="px-4 py-3">
                          {si.matchedItemId ? (
                            <div>
                              <span className="inline-block px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                                {si.matchedName}
                              </span>
                              {(() => {
                                const subtitle = subtitleFromItem(
                                  firestoreItems.find(
                                    (i) => i.id === si.matchedItemId,
                                  ),
                                );
                                return subtitle ? (
                                  <p className="text-xs text-slate-500 mt-1 truncate">
                                    {subtitle}
                                  </p>
                                ) : null;
                              })()}
                              {si.name && si.name !== si.matchedName && (
                                <p className="text-xs text-slate-400 mt-1 truncate">
                                  OCR: {si.name}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <select
                                value=""
                                onChange={(e) =>
                                  handleMatchChange(idx, e.target.value)
                                }
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
                                <p className="text-xs text-slate-400 mt-1 truncate">
                                  OCR: {si.name}
                                </p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Size column */}
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={si.size ?? ""}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                size: e.target.value || null,
                              })
                            }
                            className="w-full min-w-[64px] px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                            placeholder="--"
                          />
                        </td>

                        {/* Qty column */}
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            value={si.qty}
                            onChange={(e) =>
                              handleUpdateItem(idx, {
                                qty: parseInt(e.target.value) || 0,
                              })
                            }
                            className="w-full min-w-[64px] px-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500"
                          />
                        </td>

                        {/* Confidence column */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${confidenceColors[si.confidence]}`}
                          >
                            {si.confidence}
                          </span>
                        </td>

                        {/* Actions column */}
                        <td className="px-4 py-3">
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
                  disabled={validItems.length === 0 || committing}
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
    </div>
  );
}
