import { useState, useEffect } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  Clock,
  FileText,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Database,
  ListChecks,
  Tags,
  Boxes,
  Truck,
  Layers,
  X,
} from "lucide-react";
import { onSnapshot, query, where, orderBy } from "firebase/firestore";
import { onboardingDraftsRef } from "../../lib/firestore";
import { type CategoryNode } from "../../constants/catalogCategories";
import { useAuthContext } from "../../app/AuthProvider";
import { useCatalogCategories } from "../../hooks/useCatalogCategories";
import type { OnboardingDraft } from "../../types";

const navItems = [
  { to: "/logistics", icon: LayoutDashboard, label: "Dashboard", end: true },
  // Personnel is rendered separately with onboarding draft indicators
  { to: "/logistics/backorders", icon: Clock, label: "Backorders" },
  { to: "/logistics/orders", icon: FileText, label: "Order Lists" },
  { to: "/logistics/audit", icon: ClipboardList, label: "Audit Log" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const { isAdmin, isManager } = useAuthContext();
  const { tree: categoryTree } = useCatalogCategories();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isOnInventory = location.pathname.startsWith("/logistics/inventory");
  const isOnOnboarding = location.pathname.startsWith("/logistics/onboarding");
  const activeCat = searchParams.get("cat") ?? "all";
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["clothing"]));
  // Non-admin: gates the legacy Inventory accordion. Admin: gates the new
  // "Uniforms / PPE" parent inside the LOGISTICS group. Two states because
  // the two render paths can't share — admin defaults the section
  // expanded; non-admin defaults to "open if on inventory" to match the
  // pre-refactor behavior.
  const [inventoryOpen, setInventoryOpen] = useState(isOnInventory);
  const [uniformsOpen, setUniformsOpen] = useState(true);

  // Auto-expand whichever inventory parent applies when navigating into
  // /logistics/inventory.
  useEffect(() => {
    if (isOnInventory) {
      setInventoryOpen(true);
      setUniformsOpen(true);
    }
  }, [isOnInventory]);

  // Listen for in-progress onboarding drafts
  const [drafts, setDrafts] = useState<OnboardingDraft[]>([]);
  useEffect(() => {
    const q = query(onboardingDraftsRef, where("completedAt", "==", null), orderBy("updatedAt", "desc"));
    return onSnapshot(q, (snap) => {
      setDrafts(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OnboardingDraft));
    }, () => {});
  }, []);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectCategory(catId: string) {
    if (catId === "all") {
      navigate("/logistics/inventory");
    } else {
      navigate(`/logistics/inventory?cat=${catId}`);
    }
  }

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-y-auto transform transition-all duration-200 ease-in-out md:relative md:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      } ${collapsed ? "md:w-16 w-56" : "w-56"}`}
    >
      {/* Navy accent bar at very top */}
      <div className="h-1 bg-navy-700 shrink-0" />

      {/* Mobile-only close affordance. Desktop hides it via `md:hidden`;
          on mobile the user can also dismiss by tapping the backdrop or
          navigating away (Sidebar's location-change effect closes too). */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close menu"
        className="md:hidden absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors z-10"
      >
        <X size={18} />
      </button>

      <div className={`border-b border-gray-200 flex items-center ${collapsed ? "md:justify-center md:p-2 p-4" : "p-4"}`}>
        <div className={collapsed ? "md:hidden" : ""}>
          <h1 className="text-lg font-bold tracking-tight text-gray-900">CA-TF2</h1>
          <p className="text-xs text-gray-500">PPE Logistics</p>
        </div>
        {collapsed && (
          <span className="hidden md:block text-sm font-bold text-gray-900">TF2</span>
        )}
      </div>
      <nav className="flex-1 py-2 px-2">
        {/* Dashboard — top-level for all users */}
        <NavLink
          to="/logistics"
          end
          title="Dashboard"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
              isActive
                ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                : "text-gray-700 hover:bg-gray-100"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <LayoutDashboard size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
              <span className={collapsed ? "md:hidden" : ""}>Dashboard</span>
            </>
          )}
        </NavLink>

        {isAdmin ? (
          /* ── Admin: LOGISTICS grouping ──────────────────────────────────
             Introduces a parent "LOGISTICS" section header (admin-only)
             with one functional child ("Uniforms / PPE", containing all
             current logistics features) plus three placeholder modules
             (Cache / Vehicles / Load Planning) rendered as greyed,
             non-clickable items. */
          <>
            {!collapsed && (
              <p className="px-3 mt-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Logistics
              </p>
            )}

            {/* Uniforms / PPE — expandable parent. Click navigates to
                /logistics/inventory and ensures the child list is open. */}
            <div className="mt-0.5">
              <div className="flex items-center">
                <button
                  onClick={() => {
                    selectCategory("all");
                    setUniformsOpen(true);
                  }}
                  title="Uniforms / PPE"
                  className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                    isOnInventory
                      ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <Package size={18} className={`shrink-0 ${isOnInventory ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={`flex-1 text-left ${collapsed ? "md:hidden" : ""}`}>Uniforms / PPE</span>
                </button>
                <button
                  onClick={() => setUniformsOpen(!uniformsOpen)}
                  aria-label={uniformsOpen ? "Collapse Uniforms / PPE" : "Expand Uniforms / PPE"}
                  className={`p-2 text-gray-400 hover:text-gray-600 transition-colors ${collapsed ? "md:hidden" : ""}`}
                >
                  {uniformsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {uniformsOpen && !collapsed && (
                <div className="ml-3 mt-1 space-y-0.5 border-l border-gray-200 pl-2">
                  {/* All Items */}
                  <button
                    onClick={() => selectCategory("all")}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      activeCat === "all" && isOnInventory
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    All Items
                  </button>

                  {/* Categories tree */}
                  {categoryTree.map((node) => (
                    <SidebarCategoryItem
                      key={node.id}
                      node={node}
                      activeCat={activeCat}
                      onSelect={selectCategory}
                      expanded={expanded}
                      toggleExpand={toggleExpand}
                      depth={0}
                    />
                  ))}

                  {/* Personnel — same expand-list visual weight as the
                      categories above, with the existing onboarding-
                      draft count badge preserved. */}
                  <NavLink
                    to="/logistics/personnel"
                    title="Personnel"
                    className={({ isActive }) =>
                      `w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive || isOnOnboarding
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Users
                          size={12}
                          className={`shrink-0 ${isActive || isOnOnboarding ? "text-blue-600" : "text-gray-400"}`}
                        />
                        <span className="flex-1 text-left">Personnel</span>
                        {drafts.length > 0 && (
                          <span className="bg-amber-100 text-amber-700 text-[10px] font-medium rounded-full px-1.5">
                            {drafts.length}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>

                  <NavLink
                    to="/logistics/backorders"
                    title="Backorders"
                    className={({ isActive }) =>
                      `w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Clock size={12} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-400"}`} />
                        <span className="flex-1 text-left">Backorders</span>
                      </>
                    )}
                  </NavLink>

                  <NavLink
                    to="/logistics/orders"
                    title="Order Lists"
                    className={({ isActive }) =>
                      `w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <FileText size={12} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-400"}`} />
                        <span className="flex-1 text-left">Order Lists</span>
                      </>
                    )}
                  </NavLink>
                </div>
              )}
            </div>

            {/* Cache — wired to the management page. Vehicles and Load
                Planning remain greyed-out placeholders until those modules
                exist. Cache is intentionally a flat NavLink (not an
                expandable group) for now — it's a single management page
                today; it'll grow into an expandable section once feature #3
                ships boxes/items as children. */}
            <NavLink
              to="/logistics/admin/cache"
              title="Cache"
              className={({ isActive }) =>
                `mt-0.5 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Boxes size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={collapsed ? "md:hidden" : ""}>Cache</span>
                </>
              )}
            </NavLink>
            <DisabledNavItem icon={Truck} label="Vehicles" collapsed={collapsed} />
            <DisabledNavItem icon={Layers} label="Load Planning" collapsed={collapsed} />

            {/* Audit Log — outside the LOGISTICS group, shared with the
                non-admin layout. */}
            <div className="mt-0.5">
              <NavLink
                to="/logistics/audit"
                title="Audit Log"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                    isActive
                      ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                      : "text-gray-700 hover:bg-gray-100"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <ClipboardList size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                    <span className={collapsed ? "md:hidden" : ""}>Audit Log</span>
                  </>
                )}
              </NavLink>
            </div>
          </>
        ) : (
          /* ── Non-admin (manager / staff): legacy flat layout ────────────
             Visually unchanged from the pre-refactor sidebar. The
             LOGISTICS header and the three placeholder modules are
             intentionally hidden at these roles per the spec. */
          <>
            {/* Inventory with expandable categories */}
            <div className="mt-0.5">
              <div className="flex items-center">
                <button
                  onClick={() => { selectCategory("all"); setInventoryOpen(true); }}
                  title="Inventory"
                  className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                    isOnInventory
                      ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <Package size={18} className={`shrink-0 ${isOnInventory ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={`flex-1 text-left ${collapsed ? "md:hidden" : ""}`}>Inventory</span>
                </button>
                <button
                  onClick={() => setInventoryOpen(!inventoryOpen)}
                  className={`p-2 text-gray-400 hover:text-gray-600 transition-colors ${collapsed ? "md:hidden" : ""}`}
                >
                  {inventoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>

              {inventoryOpen && !collapsed && (
                <div className="ml-3 mt-1 space-y-0.5 border-l border-gray-200 pl-2">
                  {/* All Items */}
                  <button
                    onClick={() => selectCategory("all")}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      activeCat === "all"
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    All Items
                  </button>

                  {categoryTree.map((node) => (
                    <SidebarCategoryItem
                      key={node.id}
                      node={node}
                      activeCat={activeCat}
                      onSelect={selectCategory}
                      expanded={expanded}
                      toggleExpand={toggleExpand}
                      depth={0}
                    />
                  ))}
                </div>
              )}
              {inventoryOpen && collapsed && (
                <div className="hidden md:block" />
              )}
            </div>

            {/* Personnel — with onboarding drafts indicator */}
            <div className="mt-0.5">
              <NavLink
                to="/logistics/personnel"
                title="Personnel"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                    isActive || isOnOnboarding
                      ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                      : "text-gray-700 hover:bg-gray-100"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="relative shrink-0">
                      <Users size={18} className={isActive || isOnOnboarding ? "text-blue-600" : "text-gray-500"} />
                      {collapsed && drafts.length > 0 && (
                        <span className="hidden md:block absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {drafts.length}
                        </span>
                      )}
                    </div>
                    <span className={`flex-1 ${collapsed ? "md:hidden" : ""}`}>Personnel</span>
                    {drafts.length > 0 && (
                      <span className={`bg-amber-100 text-amber-700 text-xs font-medium rounded-full px-1.5 py-0.5 ${collapsed ? "md:hidden" : ""}`}>
                        {drafts.length} onboarding
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </div>

            {/* Remaining nav items: Backorders, Order Lists, Audit Log */}
            <div className="mt-0.5 space-y-0.5">
              {navItems.slice(1).map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                      isActive
                        ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                        : "text-gray-700 hover:bg-gray-100"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                      <span className={collapsed ? "md:hidden" : ""}>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </>
        )}

        {/* Settings — manager+admin (catalog categories) */}
        {isManager && (
          <div className="mt-4 pt-3 border-t border-gray-200 space-y-0.5">
            {!collapsed && (
              <p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Settings
              </p>
            )}
            <NavLink
              to="/logistics/admin/categories"
              title="Catalog Categories"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Tags size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={collapsed ? "md:hidden" : ""}>Categories</span>
                </>
              )}
            </NavLink>
          </div>
        )}

        {/* Admin-only section */}
        {isAdmin && (
          <div className="mt-4 pt-3 border-t border-gray-200 space-y-0.5">
            {!collapsed && (
              <p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Admin
              </p>
            )}
            <NavLink
              to="/logistics/admin/users"
              title="Users"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Shield size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={collapsed ? "md:hidden" : ""}>Users</span>
                </>
              )}
            </NavLink>
            <NavLink
              to="/logistics/admin/seed"
              title="Seed Items"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Database size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={collapsed ? "md:hidden" : ""}>Seed Items</span>
                </>
              )}
            </NavLink>
            <NavLink
              to="/logistics/admin/onboarding-template"
              title="Onboarding Template"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${collapsed ? "md:justify-center md:px-2" : ""} ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <ListChecks size={18} className={`shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
                  <span className={collapsed ? "md:hidden" : ""}>Onboarding Template</span>
                </>
              )}
            </NavLink>
          </div>
        )}
      </nav>

      {/* Collapse toggle — desktop only */}
      <button
        onClick={onToggleCollapse}
        className="hidden md:flex items-center justify-center p-3 border-t border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      <div className={`p-3 border-t border-gray-200 text-xs text-gray-400 ${collapsed ? "md:text-center" : ""}`}>
        <span className={collapsed ? "md:hidden" : ""}>USA-02 / FEMA US&R</span>
        <span className={`hidden ${collapsed ? "md:inline" : ""}`}>US&R</span>
      </div>
    </aside>
  );
}

/**
 * Greyed-out placeholder nav item used for upcoming LOGISTICS modules
 * (Cache, Vehicles, Load Planning). Not a button — a `<div>` with
 * `aria-disabled` so screen readers announce the disabled state, no
 * `onClick`, and `cursor-not-allowed` to hint at the disabled
 * interaction. The "Coming soon" tooltip surfaces via the `title`
 * attribute on hover.
 */
function DisabledNavItem({
  icon: Icon,
  label,
  collapsed,
}: {
  icon: typeof Boxes;
  label: string;
  collapsed: boolean;
}) {
  return (
    <div
      className={`mt-0.5 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 cursor-not-allowed select-none ${collapsed ? "md:justify-center md:px-2" : ""}`}
      role="presentation"
      aria-disabled="true"
      title="Coming soon"
    >
      <Icon size={18} className="shrink-0 text-slate-300" />
      <span className={collapsed ? "md:hidden" : ""}>{label}</span>
    </div>
  );
}

function SidebarCategoryItem({
  node,
  activeCat,
  onSelect,
  expanded,
  toggleExpand,
  depth,
}: {
  node: CategoryNode;
  activeCat: string;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  depth: number;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isActive = activeCat === node.id;
  // Parent is active if any child is active
  const isChildActive = hasChildren && node.children!.some((c) => c.id === activeCat);

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            toggleExpand(node.id);
            onSelect(node.id);
          } else {
            onSelect(node.id);
          }
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
          isActive || isChildActive
            ? "bg-blue-50 text-blue-700 font-semibold"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {hasChildren && (
          isExpanded
            ? <ChevronDown size={12} className="shrink-0 text-gray-400" />
            : <ChevronRight size={12} className="shrink-0 text-gray-400" />
        )}
        <span className="flex-1 text-left truncate">{node.label}</span>
      </button>
      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {node.children!.map((child) => (
            <SidebarCategoryItem
              key={child.id}
              node={child}
              activeCat={activeCat}
              onSelect={onSelect}
              expanded={expanded}
              toggleExpand={toggleExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
