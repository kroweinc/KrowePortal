import { Check } from "lucide-react";

interface FeaturesListProps {
  features: string[];
}

export function FeaturesList({ features }: FeaturesListProps) {
  if (features.length === 0) {
    return <p className="mt-1 text-sm text-neutral-400">No features extracted.</p>;
  }

  return (
    <ul className="mt-2 space-y-1.5">
      {features.map((feature, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
