/**
 * Reviewer/manager editor for a draft handover: edit claims, reject,
 * redact from recipients, verify, then approve or reject the version —
 * the human-review step the doc requires (§2.2 step 4).
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClaimWithEvidence, HandoverClaimReview } from '@knowbridge/shared';
import { get, patch, post, ApiError } from '../api';
import { Header } from './ProjectsScreen';
import { EvidenceList, OwnerLine, StatusBadge } from '../components/ClaimNodes';

interface Loaded {
  handover: {
    id: string;
    project_id: string;
    version: number;
    status: string;
    claim_reviews: HandoverClaimReview[];
    reviewer_note: string | null;
    approved_at: string | null;
  };
  claims: (ClaimWithEvidence & { evidences?: never })[];
}

export default function HandoverEditor() {
  const { handoverId = '' } = useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [reviews, setReviews] = useState<HandoverClaimReview[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await get<Loaded>(`/handovers/${handoverId}`);
        setData(loaded);
        setReviews(loaded.handover.claim_reviews);
        setNote(loaded.handover.reviewer_note ?? '');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    })();
  }, [handoverId]);

  if (error) {
    return (
      <>
        <Header user={null} />
        <div className="container">
          <div className="banner error">{error}</div>
          <Link to="/" className="muted small">
            ← Back
          </Link>
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <Header user={null} />
        <div className="container muted">Loading handover…</div>
      </>
    );
  }

  const byClaim = new Map(data.claims.map((c) => [c.id, c]));
  const patchReview = (claimId: string, changes: Partial<HandoverClaimReview>) => {
    setReviews((rs) => rs.map((r) => (r.claim_id === claimId ? { ...r, ...changes } : r)));
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch(`/handovers/${handoverId}`, { claim_reviews: reviews, reviewer_note: note });
      setNotice('Draft saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await patch(`/handovers/${handoverId}`, { claim_reviews: reviews, reviewer_note: note });
      await post(`/handovers/${handoverId}/decision`, {
        decision: approve ? 'approve' : 'reject',
      });
      window.location.href = `/handovers/${handoverId}/recipient`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  const status = data.handover.status;
  const locked = status !== 'draft';

  return (
    <>
      <Header user={null} />
      <div className="container">
        <div className="muted small" style={{ marginBottom: 6 }}>
          <Link to="/">← All projects</Link>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>
            Handover draft v{data.handover.version}
            <span className={`badge ${status === 'approved' ? 'supported' : locked ? 'unsupported' : 'needs_review'}`} style={{ marginLeft: 10 }}>
              {status}
            </span>
          </h2>
          {!locked && (
            <div className="row" style={{ flex: 'none', gap: 8 }}>
              <button className="btn secondary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save draft'}
              </button>
              <button className="btn danger" onClick={() => decide(false)} disabled={busy}>
                Reject
              </button>
              <button className="btn" onClick={() => decide(true)} disabled={busy}>
                Approve & share
              </button>
            </div>
          )}
        </div>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        {locked && (
          <div className="banner info">
            This handover is {status} — drafts only are editable. Open it from the project for the recipient view.
          </div>
        )}

        {reviews.map((r) => {
          const claim = byClaim.get(r.claim_id);
          if (!claim) return null;
          return (
            <div className="panel" key={r.claim_id}>
              <div className="row" style={{ flex: 'none', justifyContent: 'space-between' }}>
                <div className="row" style={{ flex: 'none', gap: 8 }}>
                  <span className="badge cat">{claim.category}</span>
                  <StatusBadge status={claim.status} />
                  {
                    <span className={`badge ${r.verified_by_reviewer ? 'verified' : 'unverified'}`}>
                      {r.verified_by_reviewer ? 'reviewer-verified' : 'not verified'}
                    </span>
                  }
                </div>
                <div className="row" style={{ flex: 'none', gap: 6 }}>
                  <button
                    className="btn secondary small"
                    onClick={() => patchReview(r.claim_id, { verified_by_reviewer: !r.verified_by_reviewer })}
                    disabled={locked}
                  >
                    {r.verified_by_reviewer ? 'Unverify' : 'Verify'}
                  </button>
                  <button
                    className="btn secondary small"
                    onClick={() => patchReview(r.claim_id, { redact_from_recipients: !r.redact_from_recipients })}
                    disabled={locked}
                  >
                    {r.redact_from_recipients ? 'Unredact' : 'Redact from recipients'}
                  </button>
                  <button
                    className={`btn ${r.action === 'reject' ? 'secondary' : 'danger'} small`}
                    onClick={() => patchReview(r.claim_id, { action: r.action === 'reject' ? 'include' : 'reject' })}
                    disabled={locked}
                  >
                    {r.action === 'reject' ? 'Re-include' : 'Exclude'}
                  </button>
                </div>
              </div>
              {r.edited_text !== null && r.edited_text !== claim.text ? (
                <div>
                  <label>Reviewer-edited text</label>
                  <textarea
                    value={r.edited_text ?? ''}
                    onChange={(e) => patchReview(r.claim_id, { edited_text: e.target.value })}
                    disabled={locked}
                  />
                  <div className="muted small">Original: {claim.text}</div>
                </div>
              ) : (
                <div>
                  <div style={{ marginTop: 8 }}>{claim.text}</div>
                  {claim.reasoning && <div className="reasoning">Why: {claim.reasoning}</div>}
                  <OwnerLine owner={claim.owner_text} />
                  <EvidenceList evidence={claim.evidence} />
                  <button
                    className="btn secondary small"
                    style={{ marginTop: 6 }}
                    onClick={() => patchReview(r.claim_id, { edited_text: claim.text })}
                    disabled={locked}
                  >
                    Edit text
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="panel">
          <h3>Reviewer note (shown to recipients)</h3>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context for the incoming person, unresolved gaps, things you could not confirm…"
            disabled={locked}
          />
          {!locked && (
            <button className="btn" style={{ marginTop: 10 }} onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
