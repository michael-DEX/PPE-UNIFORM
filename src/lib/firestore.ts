import { collection } from "firebase/firestore";
import type { CollectionReference, DocumentData } from "firebase/firestore";
import { db } from "./firebase";
import type {
  Item,
  Personnel,
  Transaction,
  BackorderItem,
  GearRequest,
  OrderList,
  AuditEvent,
  LogisticsUser,
  OnboardingDraft,
} from "../types";

// Firestore generates document IDs, so the stored shape omits `id`.
// Reads merge the id back in via `{ ...d.data(), id: d.id }`.
type Stored<T> = T extends { id: string } ? Omit<T, "id"> : T;

function typedCollection<T = DocumentData>(path: string) {
  return collection(db, path) as CollectionReference<Stored<T>>;
}

export const itemsRef = typedCollection<Item>("items");
export const personnelRef = typedCollection<Personnel>("personnel");
export const transactionsRef = typedCollection<Transaction>("transactions");
export const backorderedRef = typedCollection<BackorderItem>("backordered");
export const requestsRef = typedCollection<GearRequest>("requests");
export const orderListsRef = typedCollection<OrderList>("order_lists");
export const auditLogRef = typedCollection<AuditEvent>("audit_log");
export const usersRef = typedCollection<LogisticsUser>("users");
export const onboardingDraftsRef = typedCollection<OnboardingDraft>("onboarding_drafts");
