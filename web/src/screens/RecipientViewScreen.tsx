/**
 * Role-appropriate recipient view (doc §2.2 step 5):
 * only approved content, reviewer redactions hidden, sections scoped by
 * the role tag, acknowledgement recorded on read-confirm.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  RecipientRoleTag,
  ClaimCategory,
  ClaimWithEvidence,
  HandoverSection,
  SECTION_BY_CATEGORY,
} from '@knowbridge/shared';
import { get, post, ApiError } from '../api';
import { Header } from './ProjectsScreen';
import { EvidenceList, OwnerLine, StatusBadge } from '../components/ClaimNodes';

interface RecipientClaim extends Omit<ClaimWithEvidence, 'status'> {
  review_status: 'verified' | 'unverified';
}

interface RecipientPayload {
  handover: {
    id: string;
    version: number;
    status: string;
    approved_at: string | null;
    reviewer_note: string | null;
  };
  role_tag: RecipientRoleTag;
  recipient_viewer_id: string;
  claims: RecipientClaim[];
  sections: readonly string[];
}

export default function RecipientViewScreen() {
  const { handoverId = '' } = useParams();
  const [data, setData] = useState<RecipientPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [role, setRole] = useState<RecipientRoleTag | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Role tag can be switched on the fly; default comes from server.
        const payload = await get<RecipientPayload>(`/handovers/${handoverId}/recipient-view`);
        setData(payload);
        setRole(payload.role_tag);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    })();
  }, [handoverId]);

  async function switchRole(tag: RecipientRoleTag) {
    try {
      const payload = await get<RecipientPayload>(
        `/handovers/${handoverId}/recipient-view?role=${tag}`,
      );
      setData(payload);
      setRole(tag);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function acknowledge() {
    try {
      await post(`/handovers/${handoverId}/acknowledge`, {});
      setAcknowledged(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (error) {
    return (
      <>
        <Header user={null} />
        <div className="container">
          <div className="banner error">{error}</div>
          <Link to="/" className="muted small">← Back</Link>
        </div>
      </>
    );
  }
  if (!data || !role) {
    return (
      <>
        <Header user={null} />
        <div className="container muted">Loading handover…</div>
      </>
    );
  }

  const sectionOrder = [
    'overview',
    'completed',
    'pending',
    'key_decisions',
    'ownership',
    'risks',
    'dependencies',
    'next_actions',
    'open_questions',
  ] as const;

  const bySection = new Map<string, RecipientClaim[]>();
  for (const c of data.claims) {
    const s: string = SECTION_BY_CATEGORY[c.category];
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s)!.push(c);
  }

  return (
    <>
      <Header user={null} />
      <div className="container">
        <div className="muted small" style={{ marginBottom: 6 }}>
          <Link to="/">← All projects</Link>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>
            Handover v{data.handover.version}
            <span className="badge supported" style={{ marginLeft: 10 }}>
              approved {data.handover.approved_at ? new Date(data.handover.approved_at).toLocaleDateString() : ''}
            </span>
          </h2>
          <div className="row" style={{ flex: 'none', gap: 8 }}>
            <span className="muted small">Role:</span>
            <select value={role} onChange={(e) => void switchRole(e.target.value as RecipientRoleTag)} style={{ width: 'auto' }}>
              <option value="engineer">engineer</option>
              <option value="manager">manager</option>
              <option value="coordinator">coordinator</option>
              <option value="general">general</option>
            </select>
          </div>
        </div>

        <p className="muted small">
          You are viewing a role-appropriate, permission-checked handover. Claims shown as
          “unverified” were reviewed but the reviewer has not marked them personally verified —
          treat them as leads, not facts.
        </p>

        {data.handover.reviewer_note && (
          <div className="banner info">
            <strong>Reviewer note:</strong> {data.handover.reviewer_note}
          </div>
        )}

        {sectionOrder
          .filter((s) => bySection.has(s))
          .map((section) => (
            <div className="map-section" key={section}>
              <h3>
                {SECTION_LABELS[section]}{' '}
                <span className="muted small">({bySection.get(section)?.length ?? 0})</span>
              </h3>
              <div className="map-column">
                {(bySection.get(section) ?? []).map((c) => (
                  <div className="card" key={c.id}>
                    <div className="row" style={{ flex: 'none', gap: 6 }}>
                      <span className="badge cat">{c.category}</span>
                      <span className={`badge ${c.review_status}`}>
                        {c.review_status === 'verified' ? 'reviewer-verified' : 'unverified'}
                      </span>
                    </div>
                    <div style={{ marginTop: 8 }}>{c.text}</div>
                    {c.reasoning && <div className="reasoning">Why: {c.reasoning}</div>}
                    <OwnerLine owner={c.owner_text} />
                    <EvidenceList evidence={c.evidence} />
                  </div>
                ))}
              </div>
            </div>
          ))}

        <div className="panel">
          {acknowledged ? (
            <p className="muted">✅ Receipt acknowledged — thank you.</p>
          ) : (
            <button className="btn" onClick={acknowledge}>
              I have read and acknowledged this handover
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const SECTION_LABELS: Record<HandoverSection, string> = {
  overview: 'Project overview',
  completed: 'Completed work',
  pending: 'Pending work',
  key_decisions: 'Key decisions',
  ownership: 'Ownership & contacts',
  risks: 'Risks & blockers',
  dependencies: 'Dependencies',
  next_actions: 'Next actions',
  open_questions: 'Open questions',
};
