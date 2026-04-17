import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, UserPlus } from "lucide-react";
import { usePersonnel } from "../../hooks/usePersonnel";
import SearchInput from "../../components/ui/SearchInput";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import EmptyState from "../../components/ui/EmptyState";
import AddMemberModal from "./AddMemberModal";

const ROLE_LABELS: Record<string, string> = {
  rescue_specialist: "Rescue",
  search_specialist: "Search",
  medical_specialist: "Medical",
  logistics_specialist: "Logistics",
  task_force_leader: "TF Leader",
  k9_specialist: "K9",
};

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/logistics/personnel/${m.id}`)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {m.lastName}, {m.firstName}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.email}</td>
                  <td className="px-4 py-3">
                    {m.role && <Badge>{ROLE_LABELS[m.role] || m.role}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={m.isActive ? "success" : "default"}>
                      {m.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddMemberModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}
