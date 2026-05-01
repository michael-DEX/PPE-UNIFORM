import { writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { addAuditEventToBatch } from "./audit";
import type { LogisticsUser } from "../types";

/**
 * Initial caches and locations to seed when an admin first opens the cache
 * management page on an empty database. The IDs are deterministic slugs so
 * two admins racing the seed produce idempotent writes (same docs, same
 * content) rather than duplicate entries with auto-generated IDs.
 *
 * Once seeded, these become editable like any other entry — only the ID
 * stays stable (it's the foreign key shape boxes will use in feature #3).
 */
export const INITIAL_CACHES: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
}> = [
  { id: "dos", name: "DOS", description: "US Department of State sponsored cache." },
  { id: "fema", name: "FEMA", description: "FEMA-funded cache." },
  { id: "local", name: "Local", description: "Locally funded cache." },
  { id: "cal-oes", name: "CAL OES", description: "California Governor's Office of Emergency Services cache." },
  { id: "training", name: "Training", description: "Training cache (not deployable)." },
];

export const INITIAL_LOCATIONS: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
}> = [
  { id: "warehouse", name: "Warehouse", description: "Primary storage warehouse." },
  { id: "offsite-training-facility", name: "Offsite Training Facility", description: "Training facility used for stored training equipment." },
];

export async function seedCachesAndLocations(actor: LogisticsUser): Promise<void> {
  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const c of INITIAL_CACHES) {
    batch.set(doc(db, "caches", c.id), {
      name: c.name,
      description: c.description,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
  }
  for (const l of INITIAL_LOCATIONS) {
    batch.set(doc(db, "locations", l.id), {
      name: l.name,
      description: l.description,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
      updatedBy: actor.id,
    });
  }

  addAuditEventToBatch(batch, {
    type: "cache_edit",
    actorUid: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: `Seeded ${INITIAL_CACHES.length} caches and ${INITIAL_LOCATIONS.length} locations from defaults`,
  });

  await batch.commit();
}
