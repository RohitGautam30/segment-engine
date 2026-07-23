import { pct } from '../lib';

/**
 * The four lifecycle stages as a funnel. Each bar is everyone who reached that
 * stage or went further, so the width shows survival and the gap between bars
 * shows where people are lost.
 */
export default function StageFunnel({ funnel, onPick, selected }) {
  const top = Math.max(1, funnel[0]?.reached || 1);

  return (
    <div className="funnel">
      {funnel.map((s, i) => {
        const on = selected.includes(s.key);
        const dropped = i > 0 ? funnel[i - 1].reached - s.reached : 0;
        return (
          <div key={s.key} className="funnel-step">
            {i > 0 && dropped > 0 && (
              <div className="funnel-drop">
                <span>−{dropped}</span> dropped off
              </div>
            )}
            <button
              className={'funnel-bar-row' + (on ? ' funnel-on' : '')}
              onClick={() => onPick(s.key)}
              aria-pressed={on}
              title={`Filter to people whose furthest stage is "${s.label}"`}
            >
              <span className="funnel-label">{s.label}</span>
              <span className="funnel-track">
                <span
                  className="funnel-fill"
                  style={{ width: Math.max(4, (s.reached / top) * 100) + '%', background: s.shade }}
                />
              </span>
              <span className="funnel-n">{s.reached}</span>
              <span className="funnel-conv">{i === 0 ? '' : pct(s.conversion)}</span>
            </button>
          </div>
        );
      })}
      <p className="funnel-note">
        Bars count everyone who reached a stage or went further. Click one to filter
        to the people sitting there now.
      </p>
    </div>
  );
}
