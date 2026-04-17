import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import Button from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import type { Transaction, TransactionItem } from "../../types";

export default function PrintFormPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transactionId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "transactions", transactionId));
        if (snap.exists()) {
          setTransaction({ id: snap.id, ...snap.data() } as Transaction);
        } else {
          setError("Transaction not found.");
        }
      } catch {
        setError("Failed to load transaction.");
      } finally {
        setLoading(false);
      }
    })();
  }, [transactionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner />
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-slate-500">{error || "Transaction not found."}</p>
      </div>
    );
  }

  // Group items by category (use itemName prefix or fallback)
  const grouped = transaction.items.reduce<Record<string, TransactionItem[]>>(
    (acc, item) => {
      const category = "Issued Items";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    },
    {}
  );

  const txDate = transaction.timestamp?.toDate?.()?.toLocaleDateString() ?? "";

  return (
    <>
      <style>{`
        @media print {
          @page { size: letter landscape; margin: 0.5in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          nav, aside, header, [data-print-hide] { display: none !important; }
        }
      `}</style>

      <div className="min-h-screen bg-white print:bg-white">
        {/* Print button — hidden when printing */}
        <div className="p-4 flex justify-end print:hidden" data-print-hide>
          <Button onClick={() => window.print()}>Print Form</Button>
        </div>

        <div className="max-w-[10.5in] mx-auto px-6 pb-10 print:px-0 print:max-w-none text-black text-sm">
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-lg font-bold uppercase tracking-wide">
              CA-TF2 / USA-02 Gear Issue Form
            </h1>
          </div>

          {/* Member Info */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 mb-6 text-sm">
            <div className="flex gap-2">
              <span className="font-semibold">Name:</span>
              <span className="border-b border-black flex-1">
                {transaction.personnelName ?? ""}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold">Date:</span>
              <span className="border-b border-black flex-1">{txDate}</span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold">Email:</span>
              <span className="border-b border-black flex-1">&nbsp;</span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold">Issued By:</span>
              <span className="border-b border-black flex-1">
                {transaction.issuedByName}
              </span>
            </div>
          </div>

          {/* Items Table(s) */}
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-4">
              <h2 className="text-xs font-bold uppercase tracking-wider bg-slate-100 px-2 py-1 border border-black border-b-0 print:bg-gray-100">
                {category}
              </h2>
              <table className="w-full border-collapse border border-black text-xs">
                <thead>
                  <tr className="bg-slate-50 print:bg-gray-50">
                    <th className="border border-black px-2 py-1 text-left font-semibold w-[45%]">
                      Item Name
                    </th>
                    <th className="border border-black px-2 py-1 text-left font-semibold w-[15%]">
                      Size
                    </th>
                    <th className="border border-black px-2 py-1 text-center font-semibold w-[15%]">
                      Qty Issued
                    </th>
                    <th className="border border-black px-2 py-1 text-center font-semibold w-[15%]">
                      Backorder (Y/N)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-2 py-1">
                        {item.itemName}
                      </td>
                      <td className="border border-black px-2 py-1">
                        {item.size || "\u2014"}
                      </td>
                      <td className="border border-black px-2 py-1 text-center">
                        {item.qtyIssued}
                      </td>
                      <td className="border border-black px-2 py-1 text-center">
                        {item.isBackorder ? "Y" : "N"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Signature Block */}
          <div className="mt-8 text-xs leading-relaxed">
            <p className="mb-6">
              I acknowledge receipt / return of the above listed items and assume
              all responsibility, physical and financial, for its immediate return
              to the CA-TF2 cache upon completion of my membership with the CA-TF2
              taskforce. All items will be maintained and returned in a serviceable
              condition. Any lost or damaged items will be replaced by the
              undersigned, unless otherwise arranged with the CA-TF2 management and
              logistics. My signature below denotes that I have read and understand
              the terms and conditions of this issue of CA-TF2 taskforce equipment.
            </p>

            <div className="grid grid-cols-2 gap-x-12 gap-y-6 mt-8">
              <div>
                <div className="border-b border-black mb-1 h-8" />
                <p className="text-xs">Member Signature</p>
              </div>
              <div>
                <div className="border-b border-black mb-1 h-8" />
                <p className="text-xs">Date</p>
              </div>
              <div>
                <div className="border-b border-black mb-1 h-8" />
                <p className="text-xs">Logistics Officer Signature</p>
              </div>
              <div>
                <div className="border-b border-black mb-1 h-8" />
                <p className="text-xs">Date</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
