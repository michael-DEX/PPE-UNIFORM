import { Navigate, Outlet } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

export function LogisticsGuard() {
  const { isLogistics, loading, user } = useAuthContext();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin h-8 w-8 border-4 border-navy-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!isLogistics) return <Navigate to="/store" replace />;

  return <Outlet />;
}

export function AuthGuard() {
  const { loading, user } = useAuthContext();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="animate-spin h-8 w-8 border-4 border-navy-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}
