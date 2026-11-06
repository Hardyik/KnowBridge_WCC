import { useState } from 'react';
import { Claim, OWNER_UNCONFIRMED, ReviewState } from '@knowbridge/shared';
import { api } from '../api';

interface Props {
  claim: Claim;
  canReview: boolean;
  onChange?: (claim: Claim) => void;
}

export default function ClaimCard({ claim, canReview, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(claim.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { review_state?: ReviewState; text?: string }) {
    setBusy(true);
    setError(null);
    try {
      await api<{ claim: Claim }>(`/claims/${claim.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onChange?.(claim);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stateBadge = claim.review_state === 'pending' ? null : (
    <span className={`badge ${claim.review_state}`}>
      {claim.review_state === 'verified' ? 'reviewer-verified' : claim.review_state}
    </span>
  );

  return (
    <article
      className={`claim-card ${claim.review_state === 'redacted' ? 'is-redacted' : ''} ${
        claim.status === 'conflicting' ? 'is-conflicting' : ''
      }`}
    >
      <div className="spread">
        <div className="pill-row">
          <span className="badge cat">{claim.category.replace('_', ' ')}</span>
          <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
          {stateBadge}
          {claim.conflict_group && <span className="badge conflicting">conflict</span>}
          {claim.source_kind === 'github' && <span className="badge supported">github</span>}
          {claim.confidentiality !== 'internal' && (
            <span className={`badge ${claim.confidentiality === 'restricted' ? 'excluded' : 'cat'}`}>
              {claim.confidentiality}
            </span>
          )}
        </div>
        {canReview && (
          <div className="pill-row">
            {claim.review_state === 'verified' ? (
              <button className="ghost small" disabled={busy} onClick={() => void patch({ review_state: 'pending' })}>
                Unverify
              </button>
            ) : (
              <button className="ghost small" disabled={busy} onClick={() => void patch({ review_state: 'verified' })}>
                Verify
              </button>
            )}
            {claim.review_state === 'redacted' ? (
              <button className="ghost small" disabled={busy} onClick={() => void patch({ review_state: 'pending' })}>
                Un-redact
              </button>
            ) : (
              <button className="ghost small" disabled={busy} onClick={() => void patch({ review_state: 'redacted' })}>
                Redact
              </button>
            )}
            {claim.review_state === 'excluded' ? (
              <button className="ghost small" disabled={busy} onClick={() => void patch({ review_state: 'pending' })}>
                Restore
              </button>
            ) : (
              <button className="ghost small danger" disabled={busy} onClick={() => void patch({ review_state: 'excluded' })}>
                Exclude
              </button>
            )}
            <button className="ghost small" disabled={busy} onClick={() => setEditing((v) => !v)}>
              {editing ? 'Cancel' : 'Edit text'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="stack">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
          <div className="row">
            <button className="primary small" disabled={busy || draft.trim().length < 5} onClick={() => void patch({ text: draft.trim() })}>
              Save correction
            </button>
            <span className="muted tiny">The original AI text and its evidence stay in the audit trail.</span>
          </div>
        </div>
      ) : (
        <p className="claim-text">{claim.text}</p>
      )}

      {claim.owner_text === OWNER_UNCONFIRMED && (
        <span className="owner-gap">⚠ {OWNER_UNCONFIRMED} — no owner appears in this passage</span>
      )}

      <div className="evidence">
        <span className="tiny">
          {claim.evidence.source_title}
          {claim.evidence.location ? ` · ${claim.evidence.location}` : ''}
          {claim.occurred_at ? ` · ${new Date(claim.occurred_at).toLocaleDateString()}` : ''}
          {claim.evidence.quote ? '' : ' · no verbatim quote available'}
        </span>
        {claim.evidence.quote && <span className="quote-block">“{claim.evidence.quote}”</span>}
        {claim.corroborations.length > 0 && (
          <span className="corroboration">
            Also stated in {claim.corroborations.map((match) => match.source_title).join(', ')}
          </span>
        )}
      </div>

      {error && <div className="notice bad tiny">{error}</div>}
    </article>
  );
}
