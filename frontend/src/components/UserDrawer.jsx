import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ago, inrFull, tierColor } from '../lib';

export default function UserDrawer({ user, onClose }) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setDetail(null);
    setFailed(false);
    api.userDetail(user.id)
      .then((d) => live && setDetail(d))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [user]);

  if (!user) return null;

  const rows = [
    ['Lifecycle stage', user.stageLabel],
    ['External id', user.externalId],
    ['Source', user.source],
    ['Score', `${user.score} · ${user.tier.toLowerCase()}`],
    ['Profile', `${user.completion}% complete`],
    ['Top category', user.category || 'none yet'],
    ['Product views', user.productViews],
    ['Cart adds', user.cartAdds],
    ['Orders', user.purchaseCount || 'none yet'],
    ['Lifetime revenue', user.totalRevenue ? inrFull(user.totalRevenue) : '—'],
    ['Average order', user.aov ? inrFull(user.aov) : '—'],
    ['Last seen', ago(user.lastActivityAt)],
    ['Signed up', ago(user.createdAt)],
    ['Email opt-in', user.emailConsent ? 'yes' : 'no'],
    ['Last contacted', user.lastContactedAt ? ago(user.lastContactedAt) : 'never'],
  ];

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="User detail">
        <header className="drawer-head">
          <div>
            <div className="drawer-name">{user.displayName}</div>
            <div className="drawer-mail">{user.email}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="drawer-score" style={{ borderColor: tierColor(user.tier) }}>
          <span className="drawer-score-num">{user.score}</span>
          <span className="drawer-score-tier" style={{ color: tierColor(user.tier) }}>{user.tier}</span>
        </div>

        {user.breakdown && (
          <div className="breakdown">
            {[['engagement', 'Engagement'], ['monetary', 'Spend'], ['profile', 'Profile'], ['recency', 'Recency']]
              .map(([k, label]) => (
                <div key={k} className="breakdown-row">
                  <span>{label}</span>
                  <b className={(user.breakdown[k] || 0) < 0 ? 'neg' : ''}>
                    {(user.breakdown[k] || 0) > 0 ? '+' : ''}{Math.round(user.breakdown[k] || 0)}
                  </b>
                </div>
              ))}
          </div>
        )}

        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        <div className="timeline">
          <div className="eyebrow">Recent activity</div>
          {failed && <p className="dim">Activity could not be loaded.</p>}
          {!failed && !detail && <p className="dim">Loading…</p>}
          {detail?.timeline?.length === 0 && <p className="dim">No events recorded yet.</p>}
          {detail?.timeline?.slice(0, 12).map((e) => (
            <div key={e._id} className="tl-row">
              <span className="tl-type">{e.type.toLowerCase().replace(/_/g, ' ')}</span>
              <span className="tl-meta">
                {e.value ? inrFull(e.value) : e.category || ''}
              </span>
              <span className="tl-when">{ago(new Date(e.occurredAt).getTime())}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
