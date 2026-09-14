export function Sparkline({ values, color = 'var(--accent)' }: { values: number[]; color?: string }) {
  const w = 100;
  const h = 34;
  if (values.length < 2) return <svg className="spark" />;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (Math.max(0, Math.min(100, v)) / 100) * h}`);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        points={`0,${h} ${pts.join(' ')} ${w},${h}`}
        fill={color}
        fillOpacity="0.12"
        stroke="none"
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
