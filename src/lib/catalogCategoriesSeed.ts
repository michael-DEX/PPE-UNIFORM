import { writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import { CATALOG_TREE, type CategoryNode } from "../constants/catalogCategories";
import type { LogisticsUser } from "../types";

export async function seedCatalogCategories(actor: LogisticsUser): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, "app_config", "catalog_categories"), {
    tree: CATALOG_TREE as CategoryNode[],
    updatedAt: serverTimestamp(),
    updatedBy: actor.id,
  });
  addAuditEventToBatch(batch, {
    type: "catalog_categories_edit",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Seeded catalog categories (${CATALOG_TREE.length} top-level categories)`,
  });
  await batch.commit();
}

