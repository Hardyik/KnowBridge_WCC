import { useCallback, useEffect, useState } from 'react';
import { DeliveryView } from '@knowbridge/shared';
import { api, ApiError } from '../api';

export default function DeliveryScreen({ token }: { token: string }) {
  const [data, setData] = useState<DeliveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<DeliveryView>(`/delivery/${token}`);
      setData(payload);
      setAcknowledged(payload.acknowledged_at);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ acknowledgement: { acknowledged_at: string } }>(
        `/delivery/${token}/acknowledge`,
        {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined }),
        },
      );
      setAcknowledged(result.acknowledgement.acknowledged_at);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="public-page">
        <div className="empty">
          {error ? (
            <>
              <strong>This link cannot be opened</strong>
              <p className="small">{error}</p>
            </>
          ) : (
            <>
              <span className="spinner" /> Opening handover…
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="public-page">
      <header className="public-head">
        <div>
          <span className="public-brand">KnowBridge</span>
          <h1>{data.project.name}</h1>
          <p className="muted small">
            Handover v{data.handover.version} · approved{' '}
            {data.handover.approved_at ? new Date(data.handover.approved_at).toLocaleDateString() : '—'} · link
            expires {new Date(data.delivery.expires_at).toLocaleDateString()}
          </p>
        </div>
        <div className="pill-row">
          <span className="badge cat">scope · {data.delivery.scope}</span>
          {data.delivery.recipient_label && <span className="badge">{data.delivery.recipient_label}</span>}
          {acknowledged && <span className="badge supported">acknowledged</span>}
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      <div className="notice">{data.scope_note}</div>

      {data.reviewer_note && (
        <div className="card pad-lg">
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Note from the reviewer</h3>
          <p className="small">{data.reviewer_note}</p>
        </div>
      )}

      {acknowledged ? (
        <div className="notice ok">
          Receipt acknowledged on {new Date(acknowledged).toLocaleString()}. The project manager can see this.
        </div>
      ) : (
        <div className="card pad-lg stack">
          <h3 style={{ fontSize: 15 }}>Confirm you have received this handover</h3>
          <div className="row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200, flex: 1 }}>
              <label htmlFor="ack-name">Your name</label>
              <input id="ack-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div style={{ minWidth: 220, flex: 1 }}>
              <label htmlFor="ack-email">Email (optional)</label>
              <input
                id="ack-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <button className="primary" disabled={busy || name.trim().length < 2} onClick={() => void acknowledge()}>
              {busy ? 'Saving…' : 'Acknowledge'}
            </button>
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 22, marginTop: 8 }}>
        {data.sections.map((section) => (
          <section key={section.key} className="stack">
            <div className="section-title">
              <h2 style={{ fontSize: 17 }}>{section.title}</h2>
              <span className="badge cat">{section.claims.length}</span>
            </div>
            <p className="muted small">{section.blurb}</p>
            {section.claims.length === 0 && (
              <p className="muted small">Nothing recorded for this section in the sources.</p>
            )}
            <div className="grid">
              {section.claims.map((claim) => (
                <article key={claim.id} className="claim-card">
                  <div className="pill-row">
                    <span className="badge cat">{claim.category.replace('_', ' ')}</span>
                    <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
                    {claim.source_kind === 'github' && <span className="badge">github</span>}
                    {claim.review_state === 'verified' && <span className="badge supported">reviewer-verified</span>}
                  </div>
                  <p className="claim-text">{claim.text}</p>
                  {claim.owner_text && claim.owner_text !== 'Owner not confirmed' && (
                    <span className="muted tiny">Owner: {claim.owner_text}</span>
                  )}
                  <div className="evidence">
                    <span className="tiny">
                      {claim.evidence.source_title}
                      {claim.evidence.location ? ` · ${claim.evidence.location}` : ''}
                    </span>
                    {claim.evidence.quote && <span className="quote-block">“{claim.evidence.quote}”</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {data.hidden_claim_count > 0 && (
        <p className="muted tiny" style={{ marginTop: 18 }}>
          {data.hidden_claim_count} item(s) are outside this link's scope or confidentiality tier.
        </p>
      )}
    </div>
  );
}
