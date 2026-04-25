import type { Item } from "../../../types";

const PACKING_LABELS: Record<string, string> = {
  deploymentUniform: "Deployment Uniform",
  bag24hr: "24HR Bag",
  rollerBag: "Roller Bag",
  webGear: "Web Gear",
  webGearBag: "Web Gear Bag",
  coldWeatherBag: "Cold Weather Bag",
};

export default function PackingSection({ item }: { item: Item }) {
  const entries = Object.entries(item.packingLocations || {}).filter(([, qty]) => qty > 0);

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 italic py-4 text-center">No packing locations assigned</p>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3">
      {entries.map(([key, qty]) => (
        <div key={key} className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">{PACKING_LABELS[key] || key}</p>
          <p className="text-lg font-bold text-gray-900">{qty}</p>
        </div>
      ))}
    </div>
  );
}
