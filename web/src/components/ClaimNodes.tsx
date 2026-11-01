/**
 * The Knowledge Continuity Map (doc §4.2): decisions, tasks, risks,
 * dependencies, owners grouped into handover-shaped sections with
 * evidence-status badges — the differentiator vs. a generic summary.
 */
import React from 'react';
import { ClaimWithEvidence, ClaimEvidence, OWNER_UNCONFIRMED } from '@knowbridge/shared';

export const CATEGORY_LABEL: Record<ClaimWithEvidence['category'], string> = {
  decision: 'Key decisions',
  task: 'Pending work',
  risk: 'Risks & blockers',
  dependency: 'Dependencies',
  owner: 'Ownership & contacts',
  setup: 'Setup & runbooks',
  contact: 'Contacts',
  other: 'Open questions',
};

export function StatusBadge({ status }: { status: ClaimWithEvidence['status'] }) {
  return (
    <span className={`badge ${status}`}>
      {status === 'supported'
        ? 'evidenced'
        : status === 'needs_review'
          ? 'needs review'
          : status === 'conflicting'
            ? 'conflict'
            : 'no evidence'}
    </span>
  );
}

export function EvidenceList({ evidence }: { evidence: ClaimEvidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="evidence muted small">
        ⚠ No supporting source found — treat as unverified until a reviewer confirms.
      </div>
    );
  }
  return (
    <div className="evidence">
      {evidence.map((e) => (
        <div className="evidence-item" key={e.id}>
          {e.url ? <a href={e.url} target="_blank" rel="noreferrer">🔗 {e.label}</a> : <span>🔗 {e.label}</span>}
          {e.quote && <blockquote className="quote">“{e.quote}”</blockquote>}
        </div>
      ))}
    </div>
  );
}

interface MapNodeProps {
  claim: ClaimWithEvidence;
  onOpen: (c: ClaimWithEvidence) => void;
  actions?: React.ReactNode;
}

export function MapNode({ claim, onOpen, actions }: MapNodeProps) {
  const ownerLine =
    claim.category === 'owner' || claim.category === 'contact'
      ? claim.owner_text
        ? `Owner: ${claim.owner_text}`
        : `⚠ ${OWNER_UNCONFIRMED}`
      : null;
  return (
    <div className="card map-node" onClick={() => onOpen(claim)}>
      <div className="row" style={{ gap: 6, flex: 'none' }}>
        <span className="badge cat">{claim.category}</span>
        <StatusBadge status={claim.status} />
      </div>
      <div style={{ marginTop: 8 }}>{claim.text}</div>
      {claim.reasoning && <div className="reasoning">Why: {claim.reasoning}</div>}
      {ownerLine && <div className="ownerline">{ownerLine}</div>}
      {actions && (
        <div className="row" style={{ flex: 'none', marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
