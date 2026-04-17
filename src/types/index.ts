import { Timestamp } from "firebase/firestore";

// ── Item Categories ──
export type ItemCategory =
  | "bags"
  | "patches"
  | "boots"
  | "bdus"
  | "clothing"
  | "ppe"
  | "helmet"
  | "sleeping"
  | "personal";

export interface PackingLocations {
  deploymentUniform: number;
  bag24hr: number;
  rollerBag: number;
  webGear: number;
  webGearBag: number;
  coldWeatherBag: number;
}

export interface SizeStock {
  qty: number;
  lowStockThreshold?: number;
}

// Catalog categories (Square-style hierarchy)
export type CatalogCategory =
  | "packs-bags"
  | "patches"
  | "footwear"
  | "clothing-bdus"
  | "clothing-shirts"
  | "clothing-outerwear"
  | "clothing-headwear"
  | "clothing-personal"
  | "ppe-equipment"
  | "head-protection"
  | "sleep-system"
  | "personal-items";

export interface Item {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  description?: string;
  squareCategory?: string;
  category: ItemCategory;
  catalogCategory?: CatalogCategory;
  isIssuedByTeam: boolean;
  isActive: boolean;
  unitOfIssue: string;
  sizeMap: Record<string, SizeStock>;
  lowStockThreshold: number;
  packingLocations: PackingLocations;
  qtyRequired?: number;
  needsSize?: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Personnel ──
export type TeamRole =
  | "rescue_specialist"
  | "search_specialist"
  | "medical_specialist"
  | "logistics_specialist"
  | "task_force_leader"
  | "k9_specialist";

export interface MemberSizes {
  shirt?: string;
  pants?: string;
  boots?: string;
  helmet?: string;
  gloves?: string;
}

export interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  rank?: string;
  role?: TeamRole;
  email: string;
  phone?: string;
  isActive: boolean;
  joinDate: Timestamp;
  sizes: MemberSizes;
  authUid?: string;
  createdAt: Timestamp;
  createdBy: string;
}

// ── Transactions ──
export type TransactionType =
  | "onboarding_issue"
  | "single_issue"
  | "return"
  | "exchange"
  | "ocr_import";

export interface TransactionItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyIssued: number;
  isBackorder: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  personnelId: string | null;
  personnelName: string | null;
  personnelAuthUid?: string | null;
  items: TransactionItem[];
  status: "complete" | "partial";
  issuedBy: string;
  issuedByName: string;
  timestamp: Timestamp;
  notes?: string;
  signatureDataUrl?: string;
  sourceForm?: string;
  ocrConfidence?: "high" | "medium" | "low";
}

// ── Backorders ──
export interface BackorderItem {
  id: string;
  personnelId: string;
  personnelName: string;
  itemId: string;
  itemName: string;
  size: string | null;
  qtyNeeded: number;
  createdAt: Timestamp;
  createdBy: string;
  fulfilledAt: Timestamp | null;
  fulfilledBy: string | null;
  notificationSent: boolean;
  addedToOrderAt?: Timestamp | null;
}

// ── Requests (member-submitted) ──
export interface RequestItem {
  itemId: string;
  itemName: string;
  currentSize?: string;
  requestedSize?: string;
  qty: number;
}

export interface GearRequest {
  id: string;
  personnelId: string;
  personnelName: string;
  personnelAuthUid?: string;
  type: "new_item" | "exchange" | "return";
  items: RequestItem[];
  status: "pending" | "approved" | "fulfilled" | "cancelled";
  submittedAt: Timestamp;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  notes?: string;
}

// ── Order Lists ──
export interface OrderListItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyToOrder: number;
  notes?: string;
}

export interface OrderList {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp;
  exportedAt: Timestamp | null;
  items: OrderListItem[];
}

// ── Audit Log ──
export type AuditEventType = "issue" | "receive" | "return" | "adjust" | "scan";

export interface AuditItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qtyBefore: number;
  qtyAfter: number;
  delta: number;
}

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: Timestamp;
  actorUid: string;
  actorName: string;
  actorRole: string;
  personnelId: string | null;
  personnelName: string | null;
  action: string;
  transactionId: string;
  items: AuditItem[];
}

// ── Logistics Users ──
export type LogisticsRole = "admin" | "manager" | "staff";
export interface LogisticsUser {
  id: string;
  name: string;
  role: LogisticsRole;
  email: string;
  isActive: boolean;
  createdAt: Timestamp;
}

// ── Onboarding Drafts ──
export interface OnboardingDraft {
  id: string;
  memberName: string;           // "Doe, John" — for display in sidebar
  memberId: string | null;      // personnel doc ID (null if member not yet created)
  form: {
    firstName: string;
    lastName: string;
    rank: string;
    role: string;
    email: string;
    phone: string;
    shirt: string;
    pants: string;
    boots: string;
    helmet: string;
    gloves: string;
  };
  step: number;
  notes: string;
  cartItems: CartItem[];
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
}

// ── Cart (client-side only, not persisted) ──
export interface CartItem {
  itemId: string;
  itemName: string;
  size: string | null;
  qty: number;
  isBackorder: boolean;
  qtyBefore: number;
  needsSize?: boolean;      // hint: this item requires a size entry
  suggestedQty?: number;    // hint: recommended qty from gear template
}
