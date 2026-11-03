import { useCallback, useEffect, useState } from 'react';
import { RecipientView } from '@knowbridge/shared';
import { api, ApiError } from '../api';

export default function RecipientViewScreen({ handoverId }: { handoverId: string }) {
  const [data, setData] = useState<RecipientView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<RecipientView>(`/handovers/${handoverId}/recipient`);
      setData(payload);
      setAcknowledged(payload.acknowledged_at);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [handoverId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await api(`/handovers/${handoverId}/acknowledge`, { method: 'POST' });
      setAcknowledged(new Date().toISOString());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="empty">
        {error ? <>{error}</> : <><span className="spinner" /> Opening handover…</>}
      </div>
    );
  }

  return (
    <>
      <a className="back" href={`#/project/${data.project.id}`}>
        ← {data.project.name}
      </a>

      <div className="page-head">
        <div>
          <h1>{data.project.name} — handover</h1>
          <p className="muted small">
            Version {data.handover.version} · approved{' '}
            {data.handover.approved_at ? new Date(data.handover.approved_at).toLocaleString() : '—'}
          </p>
          <div className="pill-row" style={{ marginTop: 8 }}>
            <span className="badge cat">your scope · {data.scope}</span>
            {data.hidden_claim_count > 0 && (
              <span className="badge">{[data.hidden_claim_count]} item(s) not shared with your role</span>
            )}
            {acknowledged && <span className="badge supported">acknowledged</span>}
          </div>
        </div>
        <button className="primary" disabled={busy || Boolean(acknowledged)} onClick={() => void acknowledge()}>
          {acknowledged ? 'Acknowledged' : busy ? 'Saving…' : 'Acknowledge receipt'}
        </button>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="notice" style={{ marginBottom: 18 }}>
        {data.scope_note}
      </div>

      {data.reviewer_note && (
        <div className="card pad-lg" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 6 }}>Note from the reviewer</h3>
          <p className="small">{data.reviewer_note}</p>
        </div>
      )}

      {data.sections.length === 0 && (
        <div className="empty">
          <strong>Nothing shared with your role yet</strong>
          <p className="small">Ask the project manager to check your scope.</p>
        </div>
      )}

      <div className="stack" style={{ gap: 22 }}>
        {data.sections.map((section) => (
          <section key={section.key} className="stack">
            <div className="section-title">
              <h2 style={{ fontSize: 17 }}>{section.title}</h2>
              <span className="badge cat">{section.claims.length}</span>
            </div>
            <p className="muted small">{section.blurb}</p>
            {section.claims.length === 0 && (
              <p className="muted small">The sources did not record anything for this section.</p>
            )}
            <div className="grid">
              {section.claims.map((claim) => (
                <article key={claim.id} className="claim-card">
                  <div className="pill-row">
                    <span className="badge cat">{claim.category.replace('_', ' ')}</span>
                    <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
                    {claim.review_state === 'verified' && (
                      <span className="badge supported">reviewer-verified</span>
                    )}
                    {claim.owner_text === 'Owner not confirmed' && (
                      <span className="badge needs_review">owner not confirmed</span>
                    )}
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
    </>
  );
}
