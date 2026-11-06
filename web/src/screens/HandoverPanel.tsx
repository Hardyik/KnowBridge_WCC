import { useEffect, useMemo, useState } from 'react';
import {
  Claim,
  HandoverDiff,
  HandoverVersion,
  SECTION_BLURBS,
  SECTION_KEYS,
  SECTION_TITLES,
  SectionKey,
  sectionForCategory,
} from '@knowbridge/shared';
import { api } from '../api';
import ClaimCard from '../components/ClaimCard';
import DeliveryPanel from '../components/DeliveryPanel';

interface Props {
  projectId: string;
  claims: Claim[];
  handovers: HandoverVersion[];
  canApprove: boolean;
  canReview: boolean;
  onChanged: () => void;
}

export default function HandoverPanel({ projectId, claims, handovers, canApprove, canReview, onChanged }: Props) {
  const draft = useMemo(() => handovers.find((h) => h.status === 'draft') ?? null, [handovers]);
  const approved = useMemo(() => handovers.filter((h) => h.status === 'approved'), [handovers]);
  // A superseded version still holds the snapshot it was approved with, so it
  // can be compared against the current one and restored.
  const snapshots = useMemo(
    () => handovers.filter((h) => h.status === 'approved' || h.status === 'superseded'),
    [handovers],
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [diff, setDiff] = useState<HandoverDiff | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);

  useEffect(() => {
    setNote(draft?.note ?? '');
  }, [draft?.id, draft?.note]);

  const visible = claims.filter((c) => c.review_state !== 'excluded');
  const grouped = SECTION_KEYS.map((key) => ({
    key,
    claims: visible.filter((c) => sectionForCategory(c.category) === key),
  })).filter((group) => group.claims.length > 0);
  const counts = {
    redacted: claims.filter((c) => c.review_state === 'redacted').length,
    excluded: claims.filter((c) => c.review_state === 'excluded').length,
    conflicting: claims.filter((c) => c.status === 'conflicting').length,
  };

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startDraft() {
    await run(
      () => api(`/projects/${projectId}/handovers`, { method: 'POST', body: JSON.stringify({}) }),
      'Draft handover created.',
    );
  }

  async function compare(versionId: string) {
    if (!approved[0]) return;
    setDiffBusy(true);
    setError(null);
    try {
      const data = await api<{ diff: HandoverDiff }>(`/handovers/${approved[0].id}/diff/${versionId}`);
      setDiff(data.diff);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiffBusy(false);
    }
  }

  async function restore(versionId: string, version: number) {
    if (
      !window.confirm(
        `Restore v${version} as the current handover? It becomes a new approved version; nothing is deleted.`,
      )
    ) {
      return;
    }
    setDiff(null);
    await run(
      () => api(`/handovers/${versionId}/rollback`, { method: 'POST' }),
      `v${version} restored as a new approved version.`,
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {error && <div className="notice bad">{error}</div>}
      {message && <div className="notice ok">{message}</div>}

      <section className="card pad-lg stack">
        <div className="spread">
          <div>
            <h3>{draft ? `Handover draft v${draft.version}` : 'No draft handover'}</h3>
            <p className="muted small">
              {draft
                ? 'Verify, correct, redact or exclude claims, then approve to freeze this version for recipients.'
                : 'Create a draft to review the extracted claims as a handover.'}
            </p>
          </div>
          <div className="pill-row">
            {counts.redacted > 0 && <span className="badge redacted">{counts.redacted} redacted</span>}
            {counts.excluded > 0 && <span className="badge excluded">{counts.excluded} excluded</span>}
            {counts.conflicting > 0 && <span className="badge conflicting">{counts.conflicting} conflicting</span>}
            <span className="badge cat">{visible.length} in handover</span>
          </div>
        </div>

        {draft ? (
          <>
            <div>
              <label htmlFor="reviewer-note">Reviewer note to the incoming person</label>
              <textarea
                id="reviewer-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What should they know before reading? Which gaps are unresolved?"
                rows={3}
              />
            </div>
            <div className="row">
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      api(`/handovers/${draft.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ note }),
                      }),
                    'Reviewer note saved.',
                  )
                }
              >
                Save note
              </button>
              <button
                className="ghost danger"
                disabled={busy}
                onClick={() =>
                  void run(() => api(`/handovers/${draft.id}/reject`, { method: 'POST' }), 'Draft rejected.')
                }
              >
                Reject draft
              </button>
              {canApprove ? (
                <button
                  className="primary"
                  disabled={busy || visible.length === 0}
                  onClick={() =>
                    void run(
                      () => api(`/handovers/${draft.id}/approve`, { method: 'POST' }),
                      'Handover approved. Recipients can now open their scoped view.',
                    )
                  }
                >
                  Approve &amp; share
                </button>
              ) : (
                <span className="muted tiny">Only the project manager can approve.</span>
              )}
            </div>
          </>
        ) : (
          canApprove && (
            <div>
              <button className="primary" disabled={busy || claims.length === 0} onClick={() => void startDraft()}>
                Start handover draft
              </button>
              {claims.length === 0 && <p className="muted tiny">Run extraction first.</p>}
            </div>
          )
        )}
      </section>

      {grouped.map((group) => (
        <section key={group.key} className="stack">
          <div className="section-title">
            <h3>{SECTION_TITLES[group.key as SectionKey]}</h3>
            <span className="badge cat">{group.claims.length}</span>
          </div>
          <p className="muted small">{SECTION_BLURBS[group.key as SectionKey]}</p>
          <div className="grid">
            {group.claims.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} canReview={Boolean(draft)} onChange={onChanged} />
            ))}
          </div>
        </section>
      ))}

      <section className="card pad-lg stack">
        <h3>Handover versions</h3>
        {handovers.length === 0 && <p className="muted small">No versions yet.</p>}
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
              <th>Created</th>
              <th>Approved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {handovers.map((handover) => (
              <tr key={handover.id}>
                <td>v{handover.version}</td>
                <td>
                  <span className={`badge ${handover.status === 'approved' ? 'supported' : handover.status === 'draft' ? 'pending' : 'excluded'}`}>
                    {handover.status}
                  </span>
                </td>
                <td className="muted small">{new Date(handover.created_at).toLocaleString()}</td>
                <td className="muted small">
                  {handover.approved_at ? new Date(handover.approved_at).toLocaleString() : '—'}
                </td>
                <td>
                  <div className="pill-row">
                    {handover.status === 'approved' && (
                      <a className="small" href={`#/handover/${handover.id}`}>
                        Open recipient view →
                      </a>
                    )}
                    {snapshots.some((snapshot) => snapshot.id === handover.id) &&
                      approved[0] &&
                      handover.id !== approved[0].id && (
                        <>
                          <button
                            className="ghost small"
                            disabled={diffBusy}
                            onClick={() => void compare(handover.id)}
                          >
                            Compare
                          </button>
                          {canApprove && (
                            <button
                              className="ghost small"
                              disabled={busy}
                              onClick={() => void restore(handover.id, handover.version)}
                            >
                              Restore
                            </button>
                          )}
                        </>
                      )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {approved.length > 0 && (
          <div className="notice">
            Share <span className="mono">#/handover/{approved[0].id}</span> with someone who has an account, or
            issue an expiring link below for someone who does not.
          </div>
        )}
      </section>

      {diff && (
        <section className="card pad-lg stack">
          <div className="spread">
            <h3>
              v{diff.from.version} → v{diff.to.version}
            </h3>
            <button className="ghost small" onClick={() => setDiff(null)}>
              Close
            </button>
          </div>
          <p className="muted small">
            Compared against the newest approved version. Statements are matched by their text, so a refreshed
            extraction that regenerates claim ids does not read as wholesale change.
          </p>
          <div className="pill-row">
            <span className="badge supported">{diff.added.length} added</span>
            <span className="badge excluded">{diff.removed.length} removed</span>
            <span className="badge pending">{diff.changed.length} rewritten</span>
            <span className="badge cat">{diff.unchanged} unchanged</span>
          </div>

          {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
            <p className="muted small">These two versions share the same claims.</p>
          )}

          {diff.added.map((claim) => (
            <div key={claim.id} className="diff-row added">
              <span className="diff-mark">+</span>
              <div>
                <p className="small">{claim.text}</p>
                <span className="muted tiny">
                  {claim.category.replace('_', ' ')} · {claim.evidence.source_title}
                  {claim.evidence.location ? ` · ${claim.evidence.location}` : ''}
                </span>
              </div>
            </div>
          ))}

          {diff.removed.map((claim) => (
            <div key={claim.id} className="diff-row removed">
              <span className="diff-mark">−</span>
              <div>
                <p className="small">{claim.text}</p>
                <span className="muted tiny">
                  {claim.category.replace('_', ' ')} · {claim.evidence.source_title}
                </span>
              </div>
            </div>
          ))}

          {diff.changed.map((claim) => (
            <div key={claim.id} className="diff-row changed">
              <span className="diff-mark">~</span>
              <div>
                <p className="small diff-before">{claim.from_text}</p>
                <p className="small">{claim.to_text}</p>
                <span className="muted tiny">
                  {claim.category.replace('_', ' ')} · {claim.evidence.source_title}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      <DeliveryPanel
        handoverId={approved[0]?.id ?? ''}
        approved={Boolean(approved[0])}
        canManage={canApprove}
        canReview={canReview}
      />
    </div>
  );
}
