/** A bare trend line for stat tiles. Decorative: the tile states the value and its change. */
export function Sparkline({
  values,
  className,
}: {
  values: Array<number | null>;
  className?: string;
}) {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value !== null);
  if (points.length < 2) return <div aria-hidden="true" className={className} />;

  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const width = 100;
  const height = 28;
  const pad = 2;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const line = points
    .map((point) => `${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
    >
      <polygon
        points={`${x(first.index)},${height} ${line} ${x(last.index)},${height}`}
        fill="var(--series-1-soft)"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
