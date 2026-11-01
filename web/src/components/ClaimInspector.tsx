import React from 'react';
import { ClaimWithEvidence } from '@knowbridge/shared';
import { EvidenceList, StatusBadge } from './ClaimNodes';

/** Full claim view with linked-to-source evidence (doc §2.2 "Verify"). */
export default function ClaimInspector({
  claim,
  onClose,
  children,
}: {
  claim: ClaimWithEvidence | null;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  if (!claim) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ flex: 'none', justifyContent: 'space-between' }}>
          <div className="row" style={{ flex: 'none', gap: 8 }}>
            <span className="badge cat">{claim.category}</span>
            <StatusBadge status={claim.status} />
          </div>
          <button className="btn secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        <h3 style={{ marginTop: 12 }}>{claim.text}</h3>
        {claim.reasoning && <p className="reasoning">Reasoning (from source): {claim.reasoning}</p>}
        {claim.owner_text && <p className="ownerline">Owner: {claim.owner_text}</p>}
        <EvidenceList evidence={claim.evidence} />
        {children}
        <p className="muted small" style={{ marginTop: 10 }}>
          Claim id <code>{claim.id.slice(0, 8)}</code> · created {new Date(claim.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
