import { TIERS, STAGES } from '../lib';
import { Chip } from './primitives';

export default function FilterRail({ f, set, reset, total, matched, cities, categories }) {
  const toggle = (key, val) =>
    set({ ...f, [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val] });

  return (
    <aside className="rail">
      <div className="rail-head">
        <h2 className="rail-title">Narrow the audience</h2>
        <button className="link-btn" onClick={reset}>Clear all</button>
      </div>

      <label className="field">
        <span className="field-label">Search</span>
        <input className="input" placeholder="name, email or external id"
          value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} />
      </label>

      <div className="field">
        <span className="field-label">Account status</span>
        <div className="seg">
          {['ACTIVE', 'SUSPENDED', 'ALL'].map((s) => (
            <button key={s} className={'seg-btn' + (f.status === s ? ' seg-on' : '')}
              onClick={() => set({ ...f, status: s })}>{s.toLowerCase()}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Lifecycle stage {f.stages.length > 0 && <em>{f.stages.length} selected</em>}
        </span>
        <div className="chips">
          {STAGES.map((s) => (
            <Chip key={s.key} on={f.stages.includes(s.key)} color={s.shade}
              onClick={() => toggle('stages', s.key)}>{s.label.toLowerCase()}</Chip>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Tier {f.tiers.length > 0 && <em>{f.tiers.length} selected</em>}
        </span>
        <div className="chips">
          {TIERS.map((t) => (
            <Chip key={t.name} on={f.tiers.includes(t.name)} color={t.metal}
              onClick={() => toggle('tiers', t.name)}>{t.name.toLowerCase()}</Chip>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Score <em>{f.scoreMin} – {f.scoreMax}</em></span>
        <div className="range-pair">
          <input type="range" min="0" max="1000" step="10" value={f.scoreMin}
            aria-label="Minimum score"
            onChange={(e) => set({ ...f, scoreMin: Math.min(+e.target.value, f.scoreMax) })} />
          <input type="range" min="0" max="1000" step="10" value={f.scoreMax}
            aria-label="Maximum score"
            onChange={(e) => set({ ...f, scoreMax: Math.max(+e.target.value, f.scoreMin) })} />
        </div>
      </div>

      {categories.length > 0 && (
        <div className="field">
          <span className="field-label">Category interest</span>
          <div className="chips">
            {categories.map((c) => (
              <Chip key={c} on={f.categories.includes(c)} onClick={() => toggle('categories', c)}>{c}</Chip>
            ))}
          </div>
        </div>
      )}

      {cities.length > 0 && (
        <div className="field">
          <span className="field-label">City</span>
          <div className="chips">
            {cities.map((c) => (
              <Chip key={c} on={f.cities.includes(c)} onClick={() => toggle('cities', c)}>{c}</Chip>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Profile completion <em>{f.minCompletion}%+</em></span>
        <input type="range" min="0" max="100" step="5" value={f.minCompletion}
          onChange={(e) => set({ ...f, minCompletion: +e.target.value })} />
      </div>

      <div className="field">
        <span className="field-label">Inactive for <em>{f.idleMin}d+</em></span>
        <input type="range" min="0" max="90" step="5" value={f.idleMin}
          onChange={(e) => set({ ...f, idleMin: +e.target.value })} />
      </div>

      <div className="field checks">
        <label className="check">
          <input type="checkbox" checked={f.buyersOnly}
            onChange={(e) => set({ ...f, buyersOnly: e.target.checked })} />
          <span>Has bought at least once</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.consentOnly}
            onChange={(e) => set({ ...f, consentOnly: e.target.checked })} />
          <span>Email opt-in only</span>
        </label>
      </div>

      <div className="rail-foot">
        <div className="rail-count">
          <strong>{matched.toLocaleString('en-IN')}</strong>
          <span>of {total.toLocaleString('en-IN')} users</span>
        </div>
      </div>
    </aside>
  );
}
