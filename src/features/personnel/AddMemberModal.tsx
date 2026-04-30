import { useState, type FormEvent } from "react";
import { doc, setDoc, serverTimestamp, collection } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuthContext } from "../../app/AuthProvider";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AddMemberModal({ open, onClose }: Props) {
  const { logisticsUser } = useAuthContext();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    shirt: "",
    pants: "",
    boots: "",
    helmet: "",
    gloves: "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!logisticsUser) return;
    setSaving(true);

    try {
      const ref = doc(collection(db, "personnel"));
      await setDoc(ref, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        isActive: true,
        joinDate: serverTimestamp(),
        sizes: {
          shirt: form.shirt || null,
          pants: form.pants || null,
          boots: form.boots || null,
          helmet: form.helmet || null,
          gloves: form.gloves || null,
        },
        createdAt: serverTimestamp(),
        createdBy: logisticsUser.id,
      });

      setForm({
        firstName: "", lastName: "", email: "",
        shirt: "", pants: "", boots: "", helmet: "", gloves: "",
      });
      onClose();
    } catch (err) {
      console.error("Failed to add member:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Team Member" wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">First Name *</label>
            <input type="text" required value={form.firstName} onChange={(e) => update("firstName", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Last Name *</label>
            <input type="text" required value={form.lastName} onChange={(e) => update("lastName", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
            <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4 mt-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Sizes</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Shirt</label>
              <input type="text" value={form.shirt} onChange={(e) => update("shirt", e.target.value)} placeholder="e.g., L, XL" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Pants</label>
              <input type="text" value={form.pants} onChange={(e) => update("pants", e.target.value)} placeholder="e.g., 34x32" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Boots</label>
              <input type="text" value={form.boots} onChange={(e) => update("boots", e.target.value)} placeholder="e.g., 10.5 M" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Helmet</label>
              <input type="text" value={form.helmet} onChange={(e) => update("helmet", e.target.value)} placeholder="e.g., M/L" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gloves</label>
              <input type="text" value={form.gloves} onChange={(e) => update("gloves", e.target.value)} placeholder="e.g., L" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Add Member"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
