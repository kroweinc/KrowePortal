import { languageColor } from "./colors";

const SIZE = 116;
const R = SIZE / 2;

/** Point on the pie's rim at `frac` of a full turn, starting at 12 o'clock. */
function rim(frac: number): [number, number] {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return [R + R * Math.cos(a), R + R * Math.sin(a)];
}

interface LanguagePieProps {
  languages: { name: string; pct: number }[];
}

/**
 * Language split as a solid pie. Percentages come from GitHub already rounded,
 * so slices are laid out on their normalized share rather than the raw pct —
 * otherwise rounding leaves a wedge of blank canvas.
 */
export function LanguagePie({ languages }: LanguagePieProps) {
  const total = languages.reduce((sum, l) => sum + l.pct, 0);
  if (languages.length === 0 || total <= 0) return null;

  // A lone language can't be drawn as an arc (start and end coincide) — it's
  // just the whole circle.
  if (languages.length === 1) {
    return (
      <svg
        className="krowe-repo-pie"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${languages[0].name} 100%`}
      >
        <circle cx={R} cy={R} r={R} fill={languageColor(languages[0].name)} />
      </svg>
    );
  }

  // Running start angle per slice, so each wedge picks up where the last ended.
  const starts = languages.reduce<number[]>(
    (acc, lang) => [...acc, acc[acc.length - 1] + lang.pct / total],
    [0]
  );

  const slices = languages.map((lang, i) => {
    const [x1, y1] = rim(starts[i]);
    const [x2, y2] = rim(starts[i + 1]);
    const largeArc = starts[i + 1] - starts[i] > 0.5 ? 1 : 0;
    return {
      name: lang.name,
      d: `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`,
    };
  });

  return (
    <svg
      className="krowe-repo-pie"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={languages.map((l) => `${l.name} ${l.pct}%`).join(", ")}
    >
      {slices.map((s) => (
        <path key={s.name} d={s.d} fill={languageColor(s.name)} />
      ))}
    </svg>
  );
}
