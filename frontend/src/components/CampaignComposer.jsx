import { useState, useMemo } from 'react';
import { api } from '../api/client';
import { renderTemplate, TOKENS, pct, DAY } from '../lib';
import { Readout } from './primitives';

const PRESETS = [
  {
    name: 'Win back the quiet ones',
    subject: 'We saved your spot, {{user.firstName | default:there}}',
    body: 'Hi {{user.firstName | default:there}},\n\nIt has been a while. Your {{user.tier}} standing is still active and everything in {{user.category | default:our range}}...  through Sunday.\n\nSee what is new.',
  },
  {
    name: 'Reward the top tier',
    subject: '48-hour early access',
    body: 'Hi {{user.firstName | default:there}},\n\nYou are in our top tier with a score of {{user.score}}. Here is early access to the new drop before it opens to everyone.\n\nShop early.',
  },
  {
    name: 'Finish your profile',
    subject: 'You are {{user.completion}}% of the way there',
    body: 'Hi {{user.firstName | default:there}},\n\nYour profile is {{user.completion}}% complete. Add the last few details and we will tune your recommendations to what you actually ride.\n\nComplete your profile.',
  },
];

const SKIP_COPY = {
  NO_CONSENT: 'opted out of email',
  NO_EMAIL: 'no email address on file',
  FREQUENCY_CAP: 'contacted too recently',
  BELOW_MIN_SCORE: 'score below the floor',
  OVER_CAP: 'past the recipient cap',
  NOT_ACTIVE: 'account not active',
  QUIET_HOURS: 'inside quiet hours',
  DRY_RUN: 'dry run, nothing sent',
};

export default function CampaignComposer({ audience, onClose, onSent }) {
  const [name, setName] = useState(PRESETS[0].name);
  const [subject, setSubject] = useState(PRESETS[0].subject);
  const [body, setBody] = useState(PRESETS[0].body);
  const [respectConsent, setRespectConsent] = useState(true);
  const [freqCap, setFreqCap] = useState(3);
  const [minScore, setMinScore] = useState(0);
  const [maxRecipients, setMaxRecipients] = useState(0);
  const [isDryRun, setIsDryRun] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [phase, setPhase] = useState('compose'); // compose | sending | report | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  /* Preview of who survives the guard-rails. The backend applies the same
     rules again at send time; this is a local estimate so the number moves
     as you drag the sliders. */
  const preview = useMemo(() => {
    let kept = 0;
    const skips = {};
    const eligible = [];
    for (const u of audience) {
      let skip = null;
      if (u.status !== 'ACTIVE') skip = 'NOT_ACTIVE';
      else if (respectConsent && !u.emailConsent) skip = 'NO_CONSENT';
      else if (u.score < minScore) skip = 'BELOW_MIN_SCORE';
      else if (freqCap > 0 && u.lastContactedAt && Date.now() - u.lastContactedAt < freqCap * DAY) skip = 'FREQUENCY_CAP';
      else if (maxRecipients > 0 && kept >= maxRecipients) skip = 'OVER_CAP';
      if (skip) skips[skip] = (skips[skip] || 0) + 1;
      else { kept += 1; eligible.push(u); }
    }
    return { eligible, skips, skipped: audience.length - kept };
  }, [audience, respectConsent, minScore, freqCap, maxRecipients]);

  const previewUser = preview.eligible[previewIdx] || preview.eligible[0] || audience[0];

  const send = async () => {
    setPhase('sending');
    setError(null);
    try {
      const res = await api.quickSend({
        name,
        subject,
        body,
        channel: 'EMAIL',
        // Send the full selection; the backend re-applies the guard-rails so
        // the two never disagree about who was actually eligible.
        userIds: audience.map((u) => u.id),
        isDryRun,
        sync: true,
        throttle: {
          respectConsent,
          frequencyCapDays: freqCap,
          ...(minScore > 0 ? { minScore } : {}),
          ...(maxRecipients > 0 ? { maxRecipients } : {}),
        },
      });
      setResult(res);
      setPhase('report');
      onSent?.();
    } catch (err) {
      setError(err.details?.length ? err.details.map((d) => d.message).join('; ') : err.message);
      setPhase('error');
    }
  };

  const run = result?.run;
  const breakdown = result?.report?.skipReasons || {};

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <section className="composer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compose campaign">
        <header className="composer-head">
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Campaign</div>
            <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {phase === 'compose' && (
          <div className="composer-body">
            <div className="composer-main">
              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button key={p.name} className="preset"
                    onClick={() => { setName(p.name); setSubject(p.subject); setBody(p.body); }}>
                    {p.name}
                  </button>
                ))}
              </div>

              <label className="field">
                <span className="field-label">Subject line</span>
                <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>

              <label className="field">
                <span className="field-label">Message</span>
                <textarea className="textarea" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>

              <div className="token-row">
                <span className="token-hint">Insert</span>
                {TOKENS.map((t) => (
                  <button key={t} className="token" onClick={() => setBody((b) => `${b} {{${t}}}`)}>
                    {`{{${t}}}`}
                  </button>
                ))}
              </div>

              <div className="preview">
                <div className="preview-head">
                  <span className="eyebrow">Preview as</span>
                  <select className="select" value={previewIdx} onChange={(e) => setPreviewIdx(+e.target.value)}>
                    {preview.eligible.slice(0, 40).map((u, i) => (
                      <option key={u.id} value={i}>
                        {u.displayName} · {u.tier.toLowerCase()} · {u.score}
                      </option>
                    ))}
                  </select>
                </div>
                {previewUser ? (
                  <div className="preview-mail">
                    <div className="preview-subject">{renderTemplate(subject, previewUser)}</div>
                    <div className="preview-body">{renderTemplate(body, previewUser)}</div>
                  </div>
                ) : (
                  <div className="preview-mail dim">
                    Nobody is eligible yet. Loosen the rules on the right to get a preview.
                  </div>
                )}
              </div>
            </div>

            <div className="composer-side">
              <div className="audience-card">
                <div className="eyebrow">Recipients</div>
                <div className="audience-big">{preview.eligible.length.toLocaleString('en-IN')}</div>
                <div className="audience-sub">
                  {preview.skipped} filtered out of {audience.length} selected
                </div>
                <div className="audience-bar">
                  <span className="ab-send"
                    style={{ width: (preview.eligible.length / Math.max(1, audience.length)) * 100 + '%' }} />
                </div>
                {Object.entries(preview.skips).map(([k, v]) => (
                  <div key={k} className="skip-line"><span>{v}</span> {SKIP_COPY[k] || k}</div>
                ))}
              </div>

              <div className="field">
                <span className="field-label">Minimum score <em>{minScore}</em></span>
                <input type="range" min="0" max="900" step="25" value={minScore}
                  onChange={(e) => setMinScore(+e.target.value)} />
              </div>

              <div className="field">
                <span className="field-label">Do not contact within <em>{freqCap}d</em></span>
                <input type="range" min="0" max="30" step="1" value={freqCap}
                  onChange={(e) => setFreqCap(+e.target.value)} />
              </div>

              <label className="field">
                <span className="field-label">Recipient cap <em>{maxRecipients || 'none'}</em></span>
                <input className="input" type="number" min="0" value={maxRecipients}
                  onChange={(e) => setMaxRecipients(Math.max(0, +e.target.value))} />
              </label>

              <label className="check">
                <input type="checkbox" checked={respectConsent}
                  onChange={(e) => setRespectConsent(e.target.checked)} />
                <span>Skip anyone who opted out</span>
              </label>

              <label className="check">
                <input type="checkbox" checked={isDryRun} onChange={(e) => setIsDryRun(e.target.checked)} />
                <span>Dry run (record it, deliver nothing)</span>
              </label>

              <button className="send-btn" disabled={!preview.eligible.length} onClick={send}>
                {isDryRun ? 'Rehearse' : 'Send'} to {preview.eligible.length.toLocaleString('en-IN')}
              </button>
              <p className="send-note">
                This creates a real cohort, campaign and run. The mail channel logs to the API console
                instead of contacting anyone.
              </p>
            </div>
          </div>
        )}

        {phase === 'sending' && (
          <div className="sending">
            <div className="eyebrow">Dispatching</div>
            <div className="sending-num">{preview.eligible.length.toLocaleString('en-IN')}</div>
            <div className="sending-of">building the audience and writing deliveries…</div>
            <div className="audience-bar tall"><span className="ab-send indeterminate" /></div>
          </div>
        )}

        {phase === 'error' && (
          <div className="report">
            <div className="banner banner-error" role="alert">{error}</div>
            <div className="report-actions">
              <button className="send-btn" onClick={() => setPhase('compose')}>Back to the message</button>
            </div>
          </div>
        )}

        {phase === 'report' && run && (
          <div className="report">
            <div className="eyebrow">Run complete</div>
            <h3 className="report-title">{name}</h3>
            <div className="report-grid">
              <Readout label="Sent" value={run.sent.toLocaleString('en-IN')} accent="#067647" />
              <Readout label="Failed" value={run.failed} accent="#B42318" />
              <Readout label="Skipped" value={run.skipped} accent="#B54708" />
              <Readout label="Delivery rate" value={pct(result.report?.deliveryRate ?? 0)} />
            </div>

            <div className="report-skips">
              <div className="eyebrow">Why people were skipped</div>
              {Object.keys(breakdown).length === 0 && <p className="dim">Everyone selected was eligible.</p>}
              {Object.entries(breakdown).map(([k, v]) => (
                <div key={k} className="skip-line"><span>{v}</span> {SKIP_COPY[k] || k.toLowerCase()}</div>
              ))}
            </div>

            <div className="report-skips">
              <div className="eyebrow">Records created</div>
              <div className="skip-line dim">Cohort <code>{result.cohort?.name}</code></div>
              <div className="skip-line dim">Campaign id <code>{result.campaign?.id || result.campaign?._id}</code></div>
              <div className="skip-line dim">Run id <code>{run._id || run.id}</code></div>
            </div>

            <div className="report-actions">
              <button className="send-btn" onClick={() => { setPhase('compose'); setResult(null); }}>
                Compose another
              </button>
              <button className="ghost-btn" onClick={onClose}>Back to users</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
