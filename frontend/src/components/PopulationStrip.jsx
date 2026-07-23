import { tierColor } from '../lib';

/* One square per person, coloured by tier. Filtered-out people dim in place,
   so the audience reads as a quantity rather than a number that changes. */
export default function PopulationStrip({ all, matchedIds, hovered, onHover }) {
  return (
    <div className="strip-wrap">
      <div className="strip" role="img" aria-label={`${matchedIds.size} of ${all.length} users match the current filters`}>
        {all.map((u) => {
          const on = matchedIds.has(u.id);
          return (
            <span
              key={u.id}
              title={on ? `${u.displayName} · ${u.tier.toLowerCase()} · ${u.score}` : undefined}
              className={'cell' + (on ? ' cell-on' : '') + (hovered === u.id ? ' cell-hot' : '')}
              style={on ? { background: tierColor(u.tier) } : undefined}
              onMouseEnter={() => onHover(u.id)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
      </div>
    </div>
  );
}
