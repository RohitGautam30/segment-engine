export function Readout({ label, value, sub, accent }) {
  return (
    <div className="readout">
      <div className="readout-label">{label}</div>
      <div className="readout-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="readout-sub">{sub}</div>}
    </div>
  );
}

export function Sparkline({ series, height = 72, color = '#4F32D9' }) {
  if (!series?.length) return null;
  const max = Math.max(...series, 1);
  const w = 100;
  const pts = series.map((v, i) => [(i / Math.max(1, series.length - 1)) * w, height - (v / max) * (height - 4) - 2]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="spark" aria-hidden="true">
      <path d={`${d} L ${w} ${height} L 0 ${height} Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Chip({ children, on, onClick, color }) {
  return (
    <button
      type="button"
      className={'chip' + (on ? ' chip-on' : '')}
      onClick={onClick}
      style={on && color ? { borderColor: color, color } : undefined}
      aria-pressed={on}
    >
      {children}
    </button>
  );
}

export function Banner({ kind = 'info', children, onRetry }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <span>{children}</span>
      {onRetry && <button className="link-btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}
