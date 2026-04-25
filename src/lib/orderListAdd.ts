import {
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { orderListsRef } from "./firestore";
import type { OrderListItem, LogisticsUser } from "../types";

function defaultListName(): string {
  return `Order List \u2014 ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/**
 * Add a line to the newest draft (non-exported) order list. If no draft exists,
 * create a new one named for today and add to it. Merges on duplicate
 * {itemId, size} — increments qtyToOrder if the entry already exists.
 *
 * Returns { listId, listName, merged } so the caller can toast accurately.
 */
export async function addToCurrentDraftOrderList(
  actor: LogisticsUser,
  entry: OrderListItem,
): Promise<{ listId: string; listName: string; merged: boolean }> {
  // Find newest draft (exportedAt === null). This needs a composite index
  // on (exportedAt ASC, createdAt DESC) — see firestore.indexes.json.
  const draftsQuery = query(
    orderListsRef,
    where("exportedAt", "==", null),
    orderBy("createdAt", "desc"),
    limit(1),
  );
  let snap;
  try {
    snap = await getDocs(draftsQuery);
  } catch (err) {
    // Firestore's `failed-precondition` error includes a "create this index"
    // URL in its message. Re-throw with a clearer prefix so the message still
    // surfaces that URL to the caller (and the toast the user sees).
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "failed-precondition"
    ) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Order list query requires a Firestore index. ${msg}`,
      );
    }
    throw err;
  }

  let listId: string;
  let listName: string;
  let currentItems: OrderListItem[] = [];

  if (snap.empty) {
    // No draft exists — create one silently.
    const name = defaultListName();
    const newListRef = await addDoc(orderListsRef, {
      name,
      createdBy: actor.id,
      createdAt: serverTimestamp(),
      exportedAt: null,
      items: [],
    });
    listId = newListRef.id;
    listName = name;
  } else {
    const docSnap = snap.docs[0]!;
    listId = docSnap.id;
    const data = docSnap.data() as { name: string; items?: OrderListItem[] };
    listName = data.name;
    currentItems = data.items ?? [];
  }

  // Merge on duplicate {itemId, size}. size may be null on items that don't
  // track sizes — normalize both sides to null for the comparison.
  const existingIdx = currentItems.findIndex(
    (i) =>
      i.itemId === entry.itemId && (i.size ?? null) === (entry.size ?? null),
  );
  let merged = false;
  let updatedItems: OrderListItem[];
  if (existingIdx >= 0) {
    merged = true;
    updatedItems = currentItems.map((i, idx) =>
      idx === existingIdx
        ? { ...i, qtyToOrder: i.qtyToOrder + entry.qtyToOrder }
        : i,
    );
  } else {
    updatedItems = [...currentItems, entry];
  }

  await updateDoc(doc(db, "order_lists", listId), { items: updatedItems });

  return { listId, listName, merged };
}
