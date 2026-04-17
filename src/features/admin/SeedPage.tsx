/**
 * Admin-only page for seeding the Firestore `items` collection.
 *
 * Route: /logistics/admin/seed
 *
 * Workflow:
 *   1. Run `npx tsx scripts/extractSquareStock.ts` to produce
 *      scripts/squareStockData.json from the Square catalog export.
 *   2. Paste that JSON into the textarea on this page (or use the embedded
 *      default if no stock data is available).
 *   3. Click "Seed Items" -- documents are written to `items` collection.
 *
 * Only logistics_manager users can access this page (enforced by the
 * LogisticsGuard wrapper in App.tsx).
 */

import { useState, useCallback } from "react";
import {
  doc,
  setDoc,
  Timestamp,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { itemsRef } from "../../lib/firestore";
import { ITEMS_MASTER } from "../../constants/itemsMaster";
import { useAuthContext } from "../../app/AuthProvider";

// ── Types matching scripts/extractSquareStock.ts output ────────────────────
interface SizeEntry {
  qty: number;
}

interface StockEntry {
  sizeMap: Record<string, SizeEntry>;
  lowStockThreshold: number;
  description?: string;
  squareCategory?: string;
  manufacturer?: string;
  model?: string;
}

type SquareStockData = Record<string, StockEntry>;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a URL-safe document ID from an item name. */
function nameToDocId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SeedPage() {
  const { isAdmin } = useAuthContext();
  const [stockJson, setStockJson] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [wipeFirst, setWipeFirst] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");

  const appendLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, msg]);
  }, []);

  const handleSeed = useCallback(async () => {
    setLog([]);
    setRunning(true);

    try {
      // Parse stock data (empty string = no stock data, items get empty sizeMaps)
      let stockData: SquareStockData = {};
      if (stockJson.trim()) {
        try {
          stockData = JSON.parse(stockJson.trim()) as SquareStockData;
          appendLog(
            `Parsed stock data for ${Object.keys(stockData).length} items.`,
          );
        } catch {
          appendLog("ERROR: Invalid JSON in stock data textarea.");
          setRunning(false);
          return;
        }
      } else {
        appendLog(
          "No stock data pasted -- items will be created with empty sizeMaps.",
        );
      }

      // Wipe existing items if requested
      if (wipeFirst) {
        if (wipeConfirmText !== "DELETE") {
          appendLog('ERROR: Wipe toggle is on but confirmation did not match "DELETE". Aborting.');
          setRunning(false);
          return;
        }
        const allSnap = await getDocs(itemsRef);
        if (dryRun) {
          appendLog(`[DRY RUN] Would delete ${allSnap.size} existing items from Firestore.`);
        } else {
          appendLog(`Deleting ${allSnap.size} existing items from Firestore...`);
          // Batch delete in chunks of 400 (Firestore limit is 500 ops per batch)
          const docs = allSnap.docs;
          for (let i = 0; i < docs.length; i += 400) {
            const batch = writeBatch(db);
            for (const d of docs.slice(i, i + 400)) {
              batch.delete(d.ref);
            }
            await batch.commit();
          }
          appendLog(`Deleted ${allSnap.size} items.`);
        }
      } else if (!dryRun) {
        // Check for existing items to warn about overwrites
        const existingSnap = await getDocs(
          query(itemsRef, where("isActive", "==", true)),
        );
        if (!existingSnap.empty) {
          appendLog(
            `WARNING: Found ${existingSnap.size} existing items in Firestore. Documents with matching IDs will be overwritten.`,
          );
        }
      }

      const now = Timestamp.now();
      let created = 0;
      let skipped = 0;

      for (const master of ITEMS_MASTER) {
        const docId = nameToDocId(master.name);
        const stock = stockData[master.name];

        const sizeMap: Record<string, SizeEntry> = stock?.sizeMap ?? {};
        const itemDoc: Record<string, unknown> = {
          name: master.name,
          category: master.category,
          isIssuedByTeam: master.isIssuedByTeam,
          isActive: true,
          unitOfIssue: "each",
          sizeMap,
          lowStockThreshold: stock?.lowStockThreshold ?? 5,
          packingLocations: master.packing,
          qtyRequired: master.qtyRequired ?? 1,
          needsSize: master.needsSize ?? false,
          createdAt: now,
          updatedAt: now,
        };
        // Only include notes if defined (Firestore rejects undefined)
        if (master.notes) itemDoc.notes = master.notes;
        if (master.catalogCategory) itemDoc.catalogCategory = master.catalogCategory;
        if (stock?.description) itemDoc.description = stock.description;
        if (stock?.manufacturer) itemDoc.manufacturer = stock.manufacturer;
        if (stock?.model) itemDoc.model = stock.model;
        if (stock?.squareCategory) itemDoc.squareCategory = stock.squareCategory;

        if (dryRun) {
          const sizeCount = Object.keys(sizeMap).length;
          const totalQty = Object.values(sizeMap).reduce(
            (sum, s) => sum + s.qty,
            0,
          );
          appendLog(
            `[DRY RUN] ${docId}: ${master.name} | ${master.category} | ` +
              `sizes: ${sizeCount} | totalStock: ${totalQty} | ` +
              `threshold: ${itemDoc.lowStockThreshold}`,
          );
        } else {
          try {
            await setDoc(doc(db, "items", docId), itemDoc);
            appendLog(`Created: ${docId} (${master.name})`);
          } catch (err) {
            appendLog(
              `ERROR writing ${docId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            skipped++;
            continue;
          }
        }

        created++;
      }

      appendLog("---");
      if (dryRun) {
        appendLog(
          `Dry run complete. ${created} items would be created. Toggle off dry-run and click again to write to Firestore.`,
        );
      } else {
        appendLog(
          `Seed complete. ${created} items created, ${skipped} skipped due to errors.`,
        );
      }
    } catch (err) {
      appendLog(
        `FATAL: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRunning(false);
    }
  }, [stockJson, dryRun, wipeFirst, wipeConfirmText, appendLog]);

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-red-600">
        Access denied. Only admins can seed items.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Seed Items</h1>
        <p className="mt-1 text-sm text-slate-500">
          Populate the Firestore <code>items</code> collection from
          ITEMS_MASTER and Square catalog stock data.
        </p>
      </div>

      {/* Instructions */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-2">
        <p className="font-semibold">How to use:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Run{" "}
            <code className="bg-blue-100 px-1 rounded">
              npx tsx scripts/extractSquareStock.ts
            </code>{" "}
            in the project root to generate{" "}
            <code className="bg-blue-100 px-1 rounded">
              scripts/squareStockData.json
            </code>
          </li>
          <li>Paste the JSON contents into the textarea below</li>
          <li>Use dry-run first to verify, then toggle off to write</li>
        </ol>
      </div>

      {/* Stock data input */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Square Stock Data JSON (from squareStockData.json)
        </label>
        <textarea
          className="w-full h-48 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono
                     focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          placeholder='Paste squareStockData.json here, or leave empty to create items with no stock...'
          value={stockJson}
          onChange={(e) => setStockJson(e.target.value)}
          disabled={running}
        />
      </div>

      {/* Wipe first option */}
      <div className="p-3 border border-red-200 bg-red-50 rounded-lg space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-red-800">
          <input
            type="checkbox"
            checked={wipeFirst}
            onChange={(e) => {
              setWipeFirst(e.target.checked);
              if (!e.target.checked) setWipeConfirmText("");
            }}
            disabled={running}
            className="rounded border-red-300"
          />
          DELETE all existing items in Firestore before seeding
        </label>
        {wipeFirst && (
          <div className="pl-6 space-y-2">
            <p className="text-xs text-red-700">
              This permanently removes every item document in the <code>items</code> collection. Any orphans (e.g. old USAID items) will be removed too. Transaction and audit records are not touched.
            </p>
            <label className="block text-xs font-medium text-red-800">
              Type <span className="font-mono font-bold">DELETE</span> to confirm:
              <input
                type="text"
                value={wipeConfirmText}
                onChange={(e) => setWipeConfirmText(e.target.value)}
                disabled={running}
                className="mt-1 block w-40 px-2 py-1 text-sm border border-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </label>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
            className="rounded border-slate-300"
          />
          Dry run (preview only, no Firestore writes)
        </label>

        <button
          onClick={handleSeed}
          disabled={running || (wipeFirst && wipeConfirmText !== "DELETE")}
          className={`px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors
            ${
              running || (wipeFirst && wipeConfirmText !== "DELETE")
                ? "bg-slate-400 cursor-not-allowed"
                : dryRun
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-red-600 hover:bg-red-700"
            }`}
        >
          {running
            ? "Seeding..."
            : dryRun
              ? "Preview Seed (Dry Run)"
              : wipeFirst
                ? "Wipe & Seed Items to Firestore"
                : "Seed Items to Firestore"}
        </button>
      </div>

      {!dryRun && (
        <p className="text-sm text-red-600 font-medium">
          Dry-run is OFF. Clicking the button will {wipeFirst ? "WIPE ALL ITEMS and then write " : "write "}
          {ITEMS_MASTER.length} documents to Firestore.
        </p>
      )}

      {/* Log output */}
      {log.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            Output Log
          </h2>
          <pre className="bg-slate-900 text-green-400 text-xs p-4 rounded-lg overflow-auto max-h-96">
            {log.join("\n")}
          </pre>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-slate-400">
        ITEMS_MASTER contains {ITEMS_MASTER.length} items (
        {ITEMS_MASTER.filter((i) => i.isIssuedByTeam).length} team-issued,{" "}
        {ITEMS_MASTER.filter((i) => !i.isIssuedByTeam).length} personal).
      </div>
    </div>
  );
}
