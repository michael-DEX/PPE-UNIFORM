/**
 * Extract stock data from Square catalog Excel export.
 *
 * Run:  npx tsx scripts/extractSquareStock.ts
 * Output: scripts/squareStockData.json
 *
 * The JSON is a Record<gearFormName, { sizeMap, lowStockThreshold }> that the
 * SeedPage component embeds when writing items to Firestore.
 */

import XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Path to the Square export ──────────────────────────────────────────────
const CATALOG_PATH = resolve(
  "/Users/michaelnusbaum/Desktop/ppe.catf2.org",
  "Updated Inventory.xlsx",
);

// ── Square Item Name -> Gear Form Name mapping ─────────────────────────────
const SQUARE_TO_FORM_NAME: Record<string, string> = {
  "Wolf Pack Gear Max Air... (Roller Bags)": "Large Roller Bag (90 lbs. MAX)",
  "Wolf Pack Gear 24 Hour... (24-Hour)": "24 Hour Pack (35 lbs. MAX)",
  "Wolf Pack Web Gear Bag": "Web Gear Bag (40 lbs. MAX)",
  "Wolf Pack Gear Load Be... (Web Gear)": "Web Gear & Belt Kit",
  "Red Forest Service bag... (Cold Weather)":
    "Cold Weather Bag (40 lbs. MAX)",
  "US Flag Patch with Velcro": "American Flag BDU Patch",
  "CA-TF2 Rocker Patch wi...": "CA-TF2 Rocker",
  "LACoFD USAR BDU Back P...": "CA-TF2 Large Back Patch",
  "FEMA Patch with Velcro": "FEMA Shoulder Patch",
  "CALOES Patch with Velcro": "CAL OES Patch",
  "Globe Technical Rescue Boot": "Globe Rescue Boots",
  "Rocky Alpha Force (Insulated)": "Cold Weather Boots",
  "TS BDU Blouse (Tops)": "BDU Top (Tru-Spec)",
  "TS BDU Pants (Bottoms)": "BDU Pants (Tru-Spec)",
  "TS BDU Shorts (Bottoms)": "BDU Shorts",
  "CMC Cobra-D Belt (Accessories)": "Belt",
  "CA-TF2, Short Sleeve T shirt": "CA-TF2 Short Sleeve",
  "CA-TF2, Long Sleeve": "CA-TF2 Long Sleeve",
  '5.11 Polo (CA-TF2, Short Sleeve)': "CA-TF2 Polo",
  "Water Shirt": "Water Shirt",
  "Florence Marine X F1 C... (Shorts)": "Boardshorts",
  "5.11 3-IN-1 Parka (Parkas)": "3-in-1 Parka",
  "TS Gen-III ECWS Level 2 (Tops)": "Thermal Top Medium Wt.",
  "TS Gen-III ECWS Level 2 (Bottoms)": "Thermal Bottom Medium Wt.",
  "OR Rocky Mountain High (Gaiters)": "Boot Gaiters Pair",
  "TS Rain Shell Pant (Rain Gear)": "Rain Pants",
  "FlexFit 110 nu (Ball Caps)": "USAR Ball Cap",
  "Blue Boonie Hat, One Size (Boonie Hats)": "Boonie Hat",
  "Blue Beanie, One Size (Beanies)": "Beanie",
  "Neck Gaiter": "Head/Neck Gaiter",
  "Dragon Fire First-Due (Leather)": "Work Gloves",
  "Mechanix Coldwork M-PACT (Insulated)": "Cold Weather Work Gloves",
  "Mechanix Coldwork Peak (Insulated)": "Cold Weather Gloves",
  "Scott AV3000 (Masks)": "Respirator Face Piece",
  "3M 7093 Hard Shell Par... (Filters)": "Respirator Cartridge Set",
  "Pelican 3415 (Right Angle)": "Flashlight",
  "Gerber MP-600 (Standard)": "Multi-Tool",
  '3M Multiple (Ear Plugs)': "Ear Plugs",
  "Uvex S3200X (Safety Glasses)": "Safety Glasses",
  "USACE US&R Structures Specialist Field Operations Guide":
    "Structural Specialist Guide",
  "Desert Rescue Research... (Technical Rescue)": "Tech Rescue Guide",
  "LACoFD FOG": "USA-02 F.O.G.",
  "USACE US&R Shoring Operations Guide": "Shoring Guide",
  "North American Rescue ... (IFAK)": "IFAK",
  "American innotek Urina... (Urinal Bags)": "Brief Relief Urinal Bag",
  "American Innotek Daily... (Restroom Kits)": "Brief Relief Kit",
  "PICARIDIN INSECT REPELLENT 3 OZ SPRAY": "Insect Repellant",
  "Coretex SunX30 (Sunscreen)": "Sunscreen",
  "Medline Ready Bath (Wipes)": "Bath in a Bag Wipes",
  "Team Wendy EXFIL SAR Helmet": "Helmet",
  "ESS Profile Pivot (Goggles)": "Goggles",
  "Princeton Tec VIZZ II (Headlamps)": "Headlamp",
  "TW MAGPUL MOE 5-Slot M... (Rail Adapters)": "Magpul Rails",
  "TW SAR Replacement Ven... (Vent Covers)": "Vent Covers",
  "SOL Escape Bivy Orange (Bivvy)": "Emergency Bivy Sack",
  "Big Agnes Rapide Sleep... (Inflatable)": "Sleeping Pad",
  "Big Agnes Benchmark 0 Sleeping Bag": "Sleeping Bag",
  "Big Agnes Superlight Girdle (Stuff Sacks)": "Sleeping Bag Girdle",
  "Big Agnes Boundary Del... (Pillows)": "Pillow",
  "Scott Mask Bag": "WMD Kit (Scott Mask, Adapters, Bag)",
  "Scott 40mm adapter": "WMD Kit (Scott Mask, Adapters, Bag)",
  "Scott Bayonet Adapter AV-632 (Adapters)":
    "WMD Kit (Scott Mask, Adapters, Bag)",
  '3M 60000 Half Face Res...': "Respirator Face Piece",
  "5.11 TDU Blouse (Tops)": "BDU Top (5.11)",
  "5.11 EMS Pants (Bottoms)": "BDU Pants (5.11)",
  "HippyTree Design Co. U... (Shorts)": "Boardshorts",
  "Big Agnes Lost Dog 0 (Standard)": "Sleeping Bag",
  '5.11 Polo (CA-TF2, Long Sleeve)': "CA-TF2 Polo",
  "5.11 Rush 72 (72-Hour)": "24 Hour Pack (35 lbs. MAX)",
  "Solar Shower Shower": "Bath in a Bag Wipes",
  "TW SAR Comfort Pad Rep... (Comfort Pads)": "Helmet",
  "NRS Water Rescue Helme...": "Helmet",
  Flexfit: "USAR Ball Cap",
  "24 Hour Bag": "24 Hour Pack (35 lbs. MAX)",
  "Back Patch": "CA-TF2 Large Back Patch",
  "Cold Weather Bag": "Cold Weather Bag (40 lbs. MAX)",
  "Roller Bag": "Large Roller Bag (90 lbs. MAX)",
  "TS Gen-III ECWS Level 1 (Tops)": "Thermal Top Light Wt.",
  "TS Gen-III ECWS Level 1 (Bottoms)": "Thermal Bottom Light Wt.",
  // Typo variants (lowercase "l" instead of digit "1") present in some exports
  "TS Gen-III ECWS Level l (Tops)": "Thermal Top Light Wt.",
  "TS Gen-III ECWS Level l (Bottoms)": "Thermal Bottom Light Wt.",
  "Web Gear": "Web Gear & Belt Kit",
  "Web Gear Bag": "Web Gear Bag (40 lbs. MAX)",
};

// ── Manufacturer / Model lookup by gear form name ──────────────────────────
// When a form name has multiple Square sources (e.g. Respirator Face Piece can
// come from either Scott AV3000 or 3M 60000), the first match written wins.
const FORM_NAME_TO_META: Record<string, { manufacturer: string; model: string }> = {
  "Large Roller Bag (90 lbs. MAX)": { manufacturer: "Wolf Pack Gear", model: "Max Air Roller Bag" },
  "24 Hour Pack (35 lbs. MAX)": { manufacturer: "Wolf Pack Gear", model: "24 Hour Pack" },
  "Web Gear Bag (40 lbs. MAX)": { manufacturer: "Wolf Pack", model: "Web Gear Bag" },
  "Web Gear & Belt Kit": { manufacturer: "Wolf Pack Gear", model: "Load Bearing Web Gear" },
  "Cold Weather Bag (40 lbs. MAX)": { manufacturer: "US Forest Service", model: "Cold Weather Bag" },
  "American Flag BDU Patch": { manufacturer: "", model: "US Flag Patch with Velcro" },
  "CA-TF2 Rocker": { manufacturer: "", model: "CA-TF2 Rocker Patch with Velcro" },
  "CA-TF2 Large Back Patch": { manufacturer: "LACoFD", model: "USAR BDU Back Patch" },
  "FEMA Shoulder Patch": { manufacturer: "", model: "FEMA Patch with Velcro" },
  "CAL OES Patch": { manufacturer: "", model: "CALOES Patch with Velcro" },
  "Globe Rescue Boots": { manufacturer: "Globe", model: "Technical Rescue Boot" },
  "Cold Weather Boots": { manufacturer: "Rocky", model: "Alpha Force (Insulated)" },
  "BDU Top (5.11)": { manufacturer: "5.11", model: "TDU Blouse" },
  "BDU Top (Tru-Spec)": { manufacturer: "Tru-Spec", model: "BDU Blouse" },
  "BDU Pants (5.11)": { manufacturer: "5.11", model: "EMS Pants" },
  "BDU Pants (Tru-Spec)": { manufacturer: "Tru-Spec", model: "BDU Pants" },
  "BDU Shorts": { manufacturer: "Tru-Spec", model: "BDU Shorts" },
  Belt: { manufacturer: "CMC", model: "Cobra-D Belt" },
  "CA-TF2 Short Sleeve": { manufacturer: "", model: "CA-TF2 Short Sleeve T-shirt" },
  "CA-TF2 Long Sleeve": { manufacturer: "", model: "CA-TF2 Long Sleeve" },
  "CA-TF2 Polo": { manufacturer: "5.11", model: "CA-TF2 Polo" },
  "Water Shirt": { manufacturer: "", model: "Water Shirt" },
  Boardshorts: { manufacturer: "Florence Marine X", model: "F1 Boardshorts" },
  "3-in-1 Parka": { manufacturer: "5.11", model: "3-IN-1 Parka" },
  "Thermal Top Medium Wt.": { manufacturer: "Tru-Spec", model: "Gen-III ECWS Level 2 Top" },
  "Thermal Bottom Medium Wt.": { manufacturer: "Tru-Spec", model: "Gen-III ECWS Level 2 Bottom" },
  "Thermal Top Light Wt.": { manufacturer: "Tru-Spec", model: "Gen-III ECWS Level 1 Top" },
  "Thermal Bottom Light Wt.": { manufacturer: "Tru-Spec", model: "Gen-III ECWS Level 1 Bottom" },
  "Boot Gaiters Pair": { manufacturer: "Outdoor Research", model: "Rocky Mountain High Gaiters" },
  "Rain Pants": { manufacturer: "Tru-Spec", model: "Rain Shell Pant" },
  "USAR Ball Cap": { manufacturer: "FlexFit", model: "110" },
  "Boonie Hat": { manufacturer: "", model: "Blue Boonie Hat" },
  Beanie: { manufacturer: "", model: "Blue Beanie" },
  "Head/Neck Gaiter": { manufacturer: "", model: "Neck Gaiter" },
  "Work Gloves": { manufacturer: "Dragon Fire", model: "First-Due (Leather)" },
  "Cold Weather Work Gloves": { manufacturer: "Mechanix", model: "Coldwork M-PACT (Insulated)" },
  "Cold Weather Gloves": { manufacturer: "Mechanix", model: "Coldwork Peak (Insulated)" },
  "Respirator Face Piece": { manufacturer: "Scott", model: "AV3000" },
  "Respirator Cartridge Set": { manufacturer: "3M", model: "7093 Hard Shell Particulate" },
  Flashlight: { manufacturer: "Pelican", model: "3415 Right Angle" },
  "Multi-Tool": { manufacturer: "Gerber", model: "MP-600" },
  "Ear Plugs": { manufacturer: "3M", model: "Multiple" },
  "Safety Glasses": { manufacturer: "Uvex", model: "S3200X" },
  "Structural Specialist Guide": { manufacturer: "USACE", model: "US&R Structures Specialist FOG" },
  "Tech Rescue Guide": { manufacturer: "Desert Rescue Research", model: "Technical Rescue Guide" },
  "USA-02 F.O.G.": { manufacturer: "LACoFD", model: "Field Operations Guide" },
  "Shoring Guide": { manufacturer: "USACE", model: "US&R Shoring Operations Guide" },
  IFAK: { manufacturer: "North American Rescue", model: "IFAK" },
  "Brief Relief Urinal Bag": { manufacturer: "American Innotek", model: "Urinal Bag" },
  "Brief Relief Kit": { manufacturer: "American Innotek", model: "Daily Restroom Kit" },
  "Insect Repellant": { manufacturer: "", model: "Picaridin Insect Repellent" },
  Sunscreen: { manufacturer: "Coretex", model: "SunX30" },
  "Bath in a Bag Wipes": { manufacturer: "Medline", model: "Ready Bath Wipes" },
  Helmet: { manufacturer: "Team Wendy", model: "EXFIL SAR" },
  Goggles: { manufacturer: "ESS", model: "Profile Pivot" },
  Headlamp: { manufacturer: "Princeton Tec", model: "VIZZ II" },
  "Magpul Rails": { manufacturer: "Team Wendy", model: "MAGPUL MOE 5-Slot M" },
  "Vent Covers": { manufacturer: "Team Wendy", model: "SAR Replacement Vent Covers" },
  "Emergency Bivy Sack": { manufacturer: "SOL", model: "Escape Bivy Orange" },
  "Sleeping Pad": { manufacturer: "Big Agnes", model: "Rapide SL Sleeping Pad" },
  "Sleeping Bag": { manufacturer: "Big Agnes", model: "Benchmark 0" },
  "Sleeping Bag Girdle": { manufacturer: "Big Agnes", model: "Superlight Girdle" },
  Pillow: { manufacturer: "Big Agnes", model: "Boundary Deluxe Pillow" },
  "WMD Kit (Scott Mask, Adapters, Bag)": { manufacturer: "Scott", model: "Mask + Adapters Kit" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Normalise a Square variation name into a short size label. */
function normalizeSize(raw: string): string {
  if (!raw) return "ONE SIZE";
  const s = raw.trim();

  // Already short? Return uppercased.
  const upper = s.toUpperCase();
  const quickMap: Record<string, string> = {
    "X-SMALL": "XS",
    XSMALL: "XS",
    "EXTRA SMALL": "XS",
    SMALL: "S",
    MEDIUM: "M",
    LARGE: "L",
    "X-LARGE": "XL",
    XLARGE: "XL",
    "EXTRA LARGE": "XL",
    "XX-LARGE": "2XL",
    XXLARGE: "2XL",
    "2X-LARGE": "2XL",
    "XXX-LARGE": "3XL",
    XXXLARGE: "3XL",
    "3X-LARGE": "3XL",
    "ONE SIZE": "ONE SIZE",
    REGULAR: "ONE SIZE",
  };
  if (quickMap[upper]) return quickMap[upper];
  // If it looks like "32X30", "9 M", "11 W", etc. — keep as-is but uppercase
  return upper;
}

// ── Main ───────────────────────────────────────────────────────────────────

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

function main() {
  console.log("Reading Square catalog from:", CATALOG_PATH);

  const workbook = XLSX.readFile(CATALOG_PATH);

  // Find the "Items" sheet (or fall back to first sheet)
  const sheetName =
    workbook.SheetNames.find(
      (n) => n.toLowerCase() === "items" || n.toLowerCase() === "item",
    ) ?? workbook.SheetNames[0];

  console.log(`Using sheet: "${sheetName}"`);
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays (row-major) with header in row 0
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  });

  if (rows.length < 2) {
    console.error("Sheet has fewer than 2 rows — nothing to process.");
    process.exit(1);
  }

  // Identify header row (row 0) and map column letters to indices
  // Column B = index 1 (Token)
  // Column C = index 2 (Item Name)
  // Column E = index 4 (Variation Name)
  // Column AK = index 36 (Current Quantity My Business)
  // Column AM = index 38 (Stock Alert Enabled My Business)
  // Column AN = index 39 (Stock Alert Count My Business)

  const headerRow = rows[0] as string[];
  // Try to auto-detect columns by header name, fall back to fixed indices
  const COL_ITEM_NAME =
    headerRow.findIndex((h) =>
      String(h).toLowerCase().includes("item name"),
    ) !== -1
      ? headerRow.findIndex((h) =>
          String(h).toLowerCase().includes("item name"),
        )
      : 2;

  const COL_VARIATION =
    headerRow.findIndex((h) =>
      String(h).toLowerCase().includes("variation name"),
    ) !== -1
      ? headerRow.findIndex((h) =>
          String(h).toLowerCase().includes("variation name"),
        )
      : 4;

  const COL_QTY =
    headerRow.findIndex(
      (h) =>
        String(h).toLowerCase().includes("current quantity") ||
        String(h).toLowerCase().includes("current qty"),
    ) !== -1
      ? headerRow.findIndex(
          (h) =>
            String(h).toLowerCase().includes("current quantity") ||
            String(h).toLowerCase().includes("current qty"),
        )
      : 36;

  const COL_ALERT_ENABLED =
    headerRow.findIndex((h) =>
      String(h).toLowerCase().includes("stock alert enabled"),
    ) !== -1
      ? headerRow.findIndex((h) =>
          String(h).toLowerCase().includes("stock alert enabled"),
        )
      : 38;

  const COL_ALERT_COUNT =
    headerRow.findIndex((h) =>
      String(h).toLowerCase().includes("stock alert count"),
    ) !== -1
      ? headerRow.findIndex((h) =>
          String(h).toLowerCase().includes("stock alert count"),
        )
      : 39;

  const COL_DESCRIPTION =
    headerRow.findIndex((h) => String(h).toLowerCase() === "description") !== -1
      ? headerRow.findIndex((h) => String(h).toLowerCase() === "description")
      : 6;

  const COL_CATEGORIES =
    headerRow.findIndex((h) => String(h).toLowerCase() === "categories") !== -1
      ? headerRow.findIndex((h) => String(h).toLowerCase() === "categories")
      : 7;

  console.log("Detected columns:", {
    itemName: COL_ITEM_NAME,
    variation: COL_VARIATION,
    qty: COL_QTY,
    alertEnabled: COL_ALERT_ENABLED,
    alertCount: COL_ALERT_COUNT,
    description: COL_DESCRIPTION,
    categories: COL_CATEGORIES,
  });

  // Accumulate stock by gear form name
  const stockMap = new Map<string, StockEntry>();

  let unmappedCount = 0;
  const unmappedNames = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const squareName = String(row[COL_ITEM_NAME] ?? "").trim();
    if (!squareName) continue;

    const formName = SQUARE_TO_FORM_NAME[squareName];
    if (!formName) {
      if (!unmappedNames.has(squareName)) {
        unmappedNames.add(squareName);
        unmappedCount++;
      }
      continue;
    }

    const variationRaw = String(row[COL_VARIATION] ?? "").trim();
    const size = normalizeSize(variationRaw);
    const qty = parseInt(String(row[COL_QTY] ?? "0"), 10) || 0;
    const alertEnabled =
      String(row[COL_ALERT_ENABLED] ?? "").toUpperCase() === "Y";
    const alertCount = parseInt(String(row[COL_ALERT_COUNT] ?? "0"), 10) || 0;
    const description = String(row[COL_DESCRIPTION] ?? "").trim();
    const categories = String(row[COL_CATEGORIES] ?? "").trim();

    if (!stockMap.has(formName)) {
      stockMap.set(formName, {
        sizeMap: {},
        lowStockThreshold: alertEnabled && alertCount > 0 ? alertCount : 5,
      });
    }

    const entry = stockMap.get(formName)!;

    // Merge sizes: if size already exists, add quantities
    if (entry.sizeMap[size]) {
      entry.sizeMap[size].qty += qty;
    } else {
      entry.sizeMap[size] = { qty };
    }

    // Update lowStockThreshold if this row has a higher alert count
    if (alertEnabled && alertCount > entry.lowStockThreshold) {
      entry.lowStockThreshold = alertCount;
    }

    // Capture description (prefer longest non-empty)
    if (description && description.length > (entry.description?.length ?? 0)) {
      entry.description = description;
    }

    // Capture Square categories (first non-empty)
    if (categories && !entry.squareCategory) {
      entry.squareCategory = categories;
    }
  }

  // Merge manufacturer/model from lookup
  for (const [name, entry] of stockMap) {
    const meta = FORM_NAME_TO_META[name];
    if (meta) {
      if (meta.manufacturer) entry.manufacturer = meta.manufacturer;
      if (meta.model) entry.model = meta.model;
    }
  }

  // Convert to plain object for JSON serialization
  const result: Record<string, StockEntry> = {};
  for (const [name, entry] of stockMap) {
    result[name] = entry;
  }

  // Write output
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(__dirname, "squareStockData.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`\nWrote ${Object.keys(result).length} items to ${outPath}`);

  if (unmappedCount > 0) {
    console.log(`\n${unmappedCount} unmapped Square item names:`);
    for (const name of unmappedNames) {
      console.log(`  - "${name}"`);
    }
  }
}

main();
