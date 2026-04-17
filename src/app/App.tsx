import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { LogisticsGuard } from "./RoleGuard";
import LoginPage from "../features/auth/LoginPage";
import LogisticsLayout from "../features/logistics/LogisticsLayout";
import DashboardPage from "../features/logistics/DashboardPage";
import InventoryPage from "../features/inventory/InventoryPage";
import PersonnelPage from "../features/personnel/PersonnelPage";
import PersonnelDetailPage from "../features/personnel/PersonnelDetailPage";
import ScanReceivePage from "../features/inventory/ScanReceivePage";
import OnboardingPage from "../features/issue/OnboardingPage";
import OnboardingDraftsPage from "../features/issue/OnboardingDraftsPage";
import AuditLogPage from "../features/audit/AuditLogPage";
import BackorderQueuePage from "../features/backorders/BackorderQueuePage";
import OrderListsPage from "../features/backorders/OrderListsPage";
import SeedPage from "../features/admin/SeedPage";
import UsersPage from "../features/admin/UsersPage";
import PrintFormPage from "../features/print/PrintFormPage";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Logistics routes */}
          <Route element={<LogisticsGuard />}>
            <Route path="/logistics/print/:transactionId" element={<PrintFormPage />} />
            <Route element={<LogisticsLayout />}>
              <Route path="/logistics" element={<DashboardPage />} />
              <Route path="/logistics/inventory/scan" element={<ScanReceivePage />} />
              <Route path="/logistics/inventory" element={<InventoryPage />} />
              <Route path="/logistics/personnel" element={<PersonnelPage />} />
              <Route path="/logistics/personnel/:id" element={<PersonnelDetailPage />} />
              {/* /logistics/issue removed — inventory cart handles issuing */}
              <Route path="/logistics/onboarding/drafts" element={<OnboardingDraftsPage />} />
              <Route path="/logistics/onboarding/:draftId" element={<OnboardingPage />} />
              <Route path="/logistics/onboarding" element={<OnboardingPage />} />
              <Route path="/logistics/backorders" element={<BackorderQueuePage />} />
              <Route path="/logistics/orders" element={<OrderListsPage />} />
              <Route path="/logistics/audit" element={<AuditLogPage />} />
              <Route path="/logistics/admin/seed" element={<SeedPage />} />
              <Route path="/logistics/admin/users" element={<UsersPage />} />
            </Route>
          </Route>

          {/* Store routes — redirect to logistics for now */}
          <Route path="/store" element={<Navigate to="/logistics" replace />} />

          {/* Root → logistics dashboard */}
          <Route path="/" element={<Navigate to="/logistics" replace />} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
