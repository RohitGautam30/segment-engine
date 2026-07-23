import { useState, useMemo, useEffect } from 'react';
import { inr, ago, tierColor, STAGES } from '../lib';

const COLUMNS = [
  { key: 'displayName', label: 'User', w: '20%' },
  { key: 'stage', label: 'Stage', w: '13%' },
  { key: 'tier', label: 'Tier', w: '8%' },
  { key: 'score', label: 'Score', w: '9%', num: true },
  { key: 'completion', label: 'Profile', w: '11%', num: true },
  { key: 'purchaseCount', label: 'Orders', w: '8%', num: true },
  { key: 'totalRevenue', label: 'Revenue', w: '11%', num: true },
  { key: 'category', label: 'Category', w: '9%' },
  { key: 'city', label: 'City', w: '8%' },
  { key: 'lastActivityAt', label: 'Last seen', w: '11%', num: true },
];

export default function UsersTable({ rows, hovered, onHover, onOpen }) {
  const [sort, setSort] = useState({ key: 'score', dir: -1 });
  const [page, setPage] = useState(0);
  const perPage = 12;

  useEffect(() => { setPage(0); }, [rows.length, sort.key, sort.dir]);

  const sorted = useMemo(() => {
    const c = [...rows];
    c.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * sort.dir;
    });
    return c;
  }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const view = sorted.slice(page * perPage, page * perPage + perPage);

  if (!rows.length) {
    return (
      <div className="empty">
        <p className="empty-title">No users match these filters.</p>
        <p className="empty-body">Widen the score range or clear a chip in the rail to bring people back.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} style={{ width: c.w, textAlign: c.num ? 'right' : 'left' }}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}>
                  {c.label}
                  <span className="sort">{sort.key === c.key ? (sort.dir === -1 ? '▾' : '▴') : ''}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((u) => (
              <tr key={u.id} className={hovered === u.id ? 'row-hot' : ''}
                onMouseEnter={() => onHover(u.id)} onMouseLeave={() => onHover(null)}
                onClick={() => onOpen(u)} tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(u)}>
                <td>
                  <div className="u-name">{u.displayName}</div>
                  <div className="u-mail">{u.email}</div>
                </td>
                <td>
                  <span className="stage-pill"
                    style={{ borderColor: STAGES.find((s) => s.key === u.stage)?.shade }}>
                    {u.stageLabel.toLowerCase()}
                  </span>
                </td>
                <td>
                  <span className="tier-dot" style={{ background: tierColor(u.tier) }} />
                  {u.tier.toLowerCase()}
                </td>
                <td className="num strong">{u.score}</td>
                <td className="num">
                  <span className="bar"><span className="bar-fill" style={{ width: u.completion + '%' }} /></span>
                  {u.completion}%
                </td>
                <td className="num">{u.purchaseCount || '—'}</td>
                <td className="num">{u.totalRevenue ? inr(u.totalRevenue) : '—'}</td>
                <td>{u.category || '—'}</td>  
                <td>{u.city}</td>
                <td className="num dim">{ago(u.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span>{page * perPage + 1}–{Math.min((page + 1) * perPage, sorted.length)} of {sorted.length}</span>
        <div className="pager-btns">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </>
  );
}
