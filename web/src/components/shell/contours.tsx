/**
 * Contour lines, the product's one decorative motif (the app is called MAP).
 * Paths are generated from a few sine harmonics so they look surveyed rather
 * than drawn, and are identical on every render.
 */

function contourPath(cx: number, cy: number, radius: number, phase: number): string {
  const steps = 48;
  const points: Array<[number, number]> = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.16 * Math.sin(angle * 2 + phase) +
      0.09 * Math.sin(angle * 3 - phase * 1.7) +
      0.05 * Math.sin(angle * 5 + phase * 0.6);
    points.push([
      cx + Math.cos(angle) * radius * wobble * 1.25,
      cy + Math.sin(angle) * radius * wobble,
    ]);
  }
  return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
}

const RINGS = [14, 26, 39, 53, 68, 84, 101, 119];

export function Contours({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 220 120"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      {RINGS.map((radius, index) => (
        <path key={radius} d={contourPath(158, 34, radius, 0.9 + index * 0.21)} />
      ))}
    </svg>
  );
}

/** The mark: a summit drawn as three nested contour lines. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M2.5 18.5c2.2-6.8 5.2-12 9.5-12s7.3 5.2 9.5 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M6.6 18.5c1.4-4.2 3-7 5.4-7s4 2.8 5.4 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M10.3 18.5c.5-1.6 1-2.6 1.7-2.6s1.2 1 1.7 2.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
