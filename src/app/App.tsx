import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { LogisticsGuard } from "./RoleGuard";
import { ToastProvider } from "../components/ui/Toast";
import { UpdateBanner } from "../components/UpdateBanner";
import LoginPage from "../features/auth/LoginPage";
import LogisticsLayout from "../features/logistics/LogisticsLayout";
import DashboardPage from "../features/logistics/DashboardPage";
import InventoryPage from "../features/inventory/InventoryPage";
import PersonnelPage from "../features/personnel/PersonnelPage";
import PersonnelDetailPage from "../features/personnel/PersonnelDetailPage";
import OnboardingDraftsPage from "../features/issue/OnboardingDraftsPage";
import AuditLogPage from "../features/audit/AuditLogPage";
import BackorderQueuePage from "../features/backorders/BackorderQueuePage";
import OrderListsPage from "../features/backorders/OrderListsPage";
import PrintFormPage from "../features/print/PrintFormPage";
import Spinner from "../components/ui/Spinner";

// Heavy / low-traffic routes — loaded on demand.
//   ScanReceivePage:  camera + Gemini OCR bundle (~hundreds of KB)
//   OnboardingPage:   800-line form module
//   SeedPage:         admin-only, ITEMS_MASTER payload
//   UsersPage:        admin-only
const ScanReceivePage = lazy(() => import("../features/inventory/ScanReceivePage"));
const OnboardingPage = lazy(() => import("../features/issue/OnboardingPage"));
const SeedPage = lazy(() => import("../features/admin/SeedPage"));
const UsersPage = lazy(() => import("../features/admin/UsersPage"));
const OnboardingTemplatePage = lazy(() => import("../features/admin/OnboardingTemplatePage"));
const CatalogCategoriesPage = lazy(() => import("../features/admin/CatalogCategoriesPage"));
const CacheManagementPage = lazy(() => import("../features/admin/CacheManagementPage"));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center p-12">
      <Spinner />
    </div>
  );
}

export default function App() {
  return (
    <>
      {/* Mounted outside BrowserRouter + AuthProvider so it renders on
          every route (including /login) and regardless of auth state.
          Uses position: fixed internally, so it doesn't need a layout
          parent — just needs to exist in the tree. */}
      <UpdateBanner />
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Logistics routes */}
          <Route element={<LogisticsGuard />}>
            <Route path="/logistics/print/:transactionId" element={<PrintFormPage />} />
            <Route element={<LogisticsLayout />}>
              <Route path="/logistics" element={<DashboardPage />} />
              {/* Legacy /scan path redirects to the unified /receive
                  page so existing nav links and bookmarks keep working;
                  the scan flow is now an in-page modal action. */}
              <Route
                path="/logistics/inventory/scan"
                element={
                  <Navigate to="/logistics/inventory/receive" replace />
                }
              />
              <Route
                path="/logistics/inventory/receive"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <ScanReceivePage />
                  </Suspense>
                }
              />
              <Route path="/logistics/inventory" element={<InventoryPage />} />
              <Route path="/logistics/personnel" element={<PersonnelPage />} />
              <Route path="/logistics/personnel/:id" element={<PersonnelDetailPage />} />
              {/* /logistics/issue removed — inventory cart handles issuing */}
              <Route path="/logistics/onboarding/drafts" element={<OnboardingDraftsPage />} />
              <Route
                path="/logistics/onboarding/:draftId"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <OnboardingPage />
                  </Suspense>
                }
              />
              <Route
                path="/logistics/onboarding"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <OnboardingPage />
                  </Suspense>
                }
              />
              <Route path="/logistics/backorders" element={<BackorderQueuePage />} />
              <Route path="/logistics/orders" element={<OrderListsPage />} />
              <Route path="/logistics/audit" element={<AuditLogPage />} />
              <Route
                path="/logistics/admin/seed"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <SeedPage />
                  </Suspense>
                }
              />
              <Route
                path="/logistics/admin/users"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <UsersPage />
                  </Suspense>
                }
              />
              <Route
                path="/logistics/admin/onboarding-template"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <OnboardingTemplatePage />
                  </Suspense>
                }
              />
              <Route
                path="/logistics/admin/categories"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <CatalogCategoriesPage />
                  </Suspense>
                }
              />
              <Route
                path="/logistics/admin/cache"
                element={
                  <Suspense fallback={<LazyFallback />}>
                    <CacheManagementPage />
                  </Suspense>
                }
              />
            </Route>
          </Route>

          {/* Store routes — redirect to logistics for now */}
          <Route path="/store" element={<Navigate to="/logistics" replace />} />

          {/* Root → logistics dashboard */}
          <Route path="/" element={<Navigate to="/logistics" replace />} />

          <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </>
  );
}
