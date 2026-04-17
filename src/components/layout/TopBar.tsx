import { LogOut, Menu } from "lucide-react";
import { useAuthContext } from "../../app/AuthProvider";

interface TopBarProps {
  onMenuToggle?: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const { logisticsUser, signOut } = useAuthContext();

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-3 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        {/* Hamburger menu — visible on mobile only */}
        <button
          onClick={onMenuToggle}
          className="p-2 text-slate-500 hover:text-slate-700 transition-colors md:hidden"
          title="Open menu"
        >
          <Menu size={20} />
        </button>
      </div>
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        {logisticsUser && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-slate-700 truncate hidden sm:inline">
              {logisticsUser.name}
            </span>
            <span className="text-xs bg-navy-100 text-navy-700 px-2 py-0.5 rounded-full whitespace-nowrap">
              {logisticsUser.role === "admin" ? "Admin" : logisticsUser.role === "manager" ? "Manager" : "Staff"}
            </span>
          </div>
        )}
        <button
          onClick={signOut}
          className="p-2 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          title="Sign out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
