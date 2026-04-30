import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, UserPlus, ChevronRight } from "lucide-react";
import { usePersonnel } from "../../hooks/usePersonnel";
import SearchInput from "../../components/ui/SearchInput";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import EmptyState from "../../components/ui/EmptyState";
import AddMemberModal from "./AddMemberModal";

function getInitials(firstName: string, lastName: string): string {
  const f = firstName.trim().charAt(0).toUpperCase();
  const l = lastName.trim().charAt(0).toUpperCase();
  return `${f}${l}` || "?";
}

export default function PersonnelPage() {
  const { members, loading } = usePersonnel();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.firstName.toLowerCase().includes(q) ||
        m.lastName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-900">Personnel</h1>
        <Button onClick={() => setShowAdd(true)}>
          <UserPlus size={16} />
          Add Member
        </Button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name or email..."
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users size={48} />}
          title="No members found"
          description={search ? "Try a different search" : "Add your first team member"}
          action={
            !search && (
              <Button onClick={() => setShowAdd(true)}>
                <UserPlus size={16} />
                Add Member
              </Button>
            )
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <ul>
            {filtered.map((m) => (
              <li
                key={m.id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/logistics/personnel/${m.id}`)}
                  aria-label={`${m.firstName} ${m.lastName}, ${m.isActive ? "Active" : "Inactive"}`}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                >
                  {/* Avatar */}
                  <span
                    aria-hidden="true"
                    className="shrink-0 h-10 w-10 rounded-full bg-navy-100 text-navy-700 inline-flex items-center justify-center text-sm font-semibold"
                  >
                    {getInitials(m.firstName, m.lastName)}
                  </span>

                  {/* Name + email */}
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="font-medium text-slate-900 text-sm truncate">
                      {m.lastName}, {m.firstName}
                    </span>
                    <span className="text-xs text-slate-500 truncate">
                      {m.email}
                    </span>
                  </span>

                  {/* Status + chevron */}
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={m.isActive ? "success" : "default"}
                      className="whitespace-nowrap"
                    >
                      {m.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddMemberModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
