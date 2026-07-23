import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, setOnLogout, clearSession } from './api/client';
import {
  adaptUser, applyFilters, summarise, EMPTY_FILTERS,
  TIERS, tierFor, tierColor, inr, pct,
} from './lib';
import { Readout, Sparkline, Banner } from './components/primitives';
import Login from './components/Login';
import FilterRail from './components/FilterRail';
import PopulationStrip from './components/PopulationStrip';
import UsersTable from './components/UsersTable';
import StageFunnel from './components/StageFunnel';
import UserDrawer from './components/UserDrawer';
import CampaignComposer from './components/CampaignComposer';

export default function App() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [f, setF] = useState(EMPTY_FILTERS);
  const [hovered, setHovered] = useState(null);
  const [drawerUser, setDrawerUser] = useState(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => { setOnLogout(() => { setMe(null); setUsers([]); }); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { users: raw } = await api.fetchAllUsers({
        onProgress: (n, total) => setProgress({ n, total }),
      });
      setUsers(raw.map(adaptUser));
    } catch (err) {
      setLoadError(
        err.status === 403
          ? 'This account cannot list users. Sign in as an admin, manager or analyst.'
          : err.message
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => { if (me) load(); }, [me, load]);

  const filtered = useMemo(() => applyFilters(users, f), [users, f]);
  const matchedIds = useMemo(() => new Set(filtered.map((u) => u.id)), [filtered]);
  const stats = useMemo(() => summarise(filtered, users.length), [filtered, users.length]);

  const cities = useMemo(
    () => [...new Set(users.map((u) => u.city).filter((c) => c && c !== '—'))].sort().slice(0, 12),
    [users]
  );
  const categories = useMemo(
    () => [...new Set(users.map((u) => u.category).filter(Boolean) )].sort().slice(0, 12),
    [users]
  );

  const maxTier = Math.max(1, ...stats.tierCounts.map((t) => t.n));

  if (!me) return <Login onSignedIn={setMe} />;

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Segment Console</span>
        </div>
        <div className="topbar-meta">
          <span>{users.length.toLocaleString('en-IN')} users loaded</span>
          <span className="sep" />
          <button className="link-btn" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="sep" />
          <span className="env">{me.role?.toLowerCase()}</span>
          <span>{me.email}</span>
          <button className="link-btn" onClick={async () => { await api.logout(); clearSession(); setMe(null); }}>
            Sign out
          </button>
        </div>
      </header>

      {loadError && (
        <div style={{ padding: '12px 18px 0' }}>
          <Banner kind="error" onRetry={load}>{loadError}</Banner>
        </div>
      )}

      {loading && !users.length && (
        <div className="boot">
          <div className="boot-num">{progress ? progress.n : 0}</div>
          <p>Loading the population{progress?.total ? ` of ${progress.total}` : ''}…</p>
        </div>
      )}

      {!loading && !users.length && !loadError && (
        <div className="boot">
          <p className="empty-title">No users yet.</p>
          <p className="empty-body">
            Run <code>npm run seed</code> in the backend to create a population, then refresh.
          </p>
        </div>
      )}

      {users.length > 0 && (
        <div className="layout">
          <FilterRail
            f={f} set={setF} reset={() => setF(EMPTY_FILTERS)}
            total={users.length} matched={filtered.length}
            cities={cities} categories={categories}
          />

          <main className="main">
            <section className="panel strip-panel">
              <div className="panel-head">
                <h1 className="panel-title">Your audience</h1>
                <p className="panel-sub">Every square is one person. Filters dim the ones who fall out.</p>
              </div>
              <PopulationStrip all={users} matchedIds={matchedIds} hovered={hovered} onHover={setHovered} />
              <div className="legend">
                {TIERS.map((t) => (
                  <span key={t.name} className="legend-item">
                    <span className="legend-dot" style={{ background: t.metal }} />
                    {t.name.toLowerCase()} <b>{stats.tierCounts.find((x) => x.name === t.name).n}</b>
                  </span>
                ))}
              </div>
            </section>

            <section className="readouts">
              <Readout label="In selection" value={filtered.length.toLocaleString('en-IN')}
                sub={`${pct(stats.share)} of all users`} />
              <Readout label="Cumulative revenue" value={inr(stats.revenue)}
                sub={`${stats.orders} orders from ${stats.buyers} buyers`} />
              <Readout label="Average score" value={Math.round(stats.avgScore)}
                sub={`${tierFor(stats.avgScore).name.toLowerCase()} on average`}
                accent={tierColor(tierFor(stats.avgScore).name)} />
              <Readout label="Profile completeness" value={pct(stats.avgCompletion)}
                sub="average across selection" />
              <Readout label="Contactable now" value={stats.reachable.toLocaleString('en-IN')}
                sub="active and opted in" accent="#067647" />
            </section>

            <section className="split">
              <div className="panel chart-panel">
                <div className="panel-head tight">
                  <h2 className="panel-title sm">Lifecycle funnel</h2>
                  <span className="panel-note">4 stages</span>
                </div>
                <StageFunnel
                  funnel={stats.funnel}
                  selected={f.stages}
                  onPick={(key) =>
                    setF((prev) => ({
                      ...prev,
                      stages: prev.stages.includes(key)
                        ? prev.stages.filter((s) => s !== key)
                        : [...prev.stages, key],
                    }))
                  }
                />
              </div>

              <div className="panel chart-panel">
                <div className="panel-head tight">
                  <h2 className="panel-title sm">Tier distribution</h2>
                  <span className="panel-note">by score</span>
                </div>
                <div className="tier-bars">
                  {stats.tierCounts.map((t) => (
                    <div key={t.name} className="tier-row">
                      <span className="tier-name">{t.name.toLowerCase()}</span>
                      <span className="tier-track">
                        <span className="tier-fill" style={{ width: (t.n / maxTier) * 100 + '%', background: t.metal }} />
                      </span>
                      <span className="tier-n">{t.n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="split">
              <div className="panel chart-panel">
                <div className="panel-head tight">
                  <h2 className="panel-title sm">Cumulative signups</h2>
                  <span className="panel-note">26 weeks</span>
                </div>
                <Sparkline series={stats.cumulative} />
                <div className="chart-foot">
                  <span>{stats.cumulative[0] || 0}</span>
                  <span>{stats.cumulative[stats.cumulative.length - 1] || 0} total</span>
                </div>
              </div>

            </section>

            <section className="panel table-panel">
              <div className="panel-head tight">
                <h2 className="panel-title sm">Users in selection</h2>
                <button className="cta" onClick={() => setComposing(true)} disabled={!filtered.length}>
                  Send a campaign to these {filtered.length.toLocaleString('en-IN')}
                </button>
              </div>
              <UsersTable rows={filtered} hovered={hovered} onHover={setHovered} onOpen={setDrawerUser} />
            </section>
          </main>
        </div>
      )}

      <UserDrawer user={drawerUser} onClose={() => setDrawerUser(null)} />
      {composing && (
        <CampaignComposer
          audience={filtered}
          onClose={() => setComposing(false)}
          onSent={load}
        />
      )}
    </div>
  );
}
