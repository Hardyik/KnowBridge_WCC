/**
 * Shared contract between the Express API and the React client.
 *
 * The handover model is deliberately small: a project owns sources, sources
 * become chunks, chunks produce evidence-linked claims, and an approved
 * handover freezes a snapshot of those claims for a role-scoped recipient.
 */

// ---------------------------------------------------------------------------
// Project access
// ---------------------------------------------------------------------------

export const MEMBER_ROLES = ['manager', 'reviewer', 'recipient'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** What an incoming person is allowed to see. Chosen by the project manager. */
export const RECIPIENT_SCOPES = ['engineer', 'manager', 'coordinator', 'general'] as const;
export type RecipientScope = (typeof RECIPIENT_SCOPES)[number];

export interface Profile {
  id: string;
  email: string;
  display_name: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: MemberRole;
  scope: RecipientScope;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  created_at: string;
}

export interface ProjectSummary extends Project {
  role: MemberRole;
  scope: RecipientScope;
  source_count: number;
  claim_count: number;
  approved_handover: { id: string; version: number; approved_at: string } | null;
}

// ---------------------------------------------------------------------------
// Sources and evidence
// ---------------------------------------------------------------------------

export type SourceStatus = 'ready' | 'failed';

/** Where a source came from: an uploaded file or a connected repository. */
export const SOURCE_KINDS = ['document', 'github'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  document: 'Document',
  github: 'GitHub',
};

/**
 * Confidentiality is a per-source tier. The server, never the client, decides
 * whether a recipient may see a claim from a source.
 */
export const CONFIDENTIALITY_TIERS = ['public', 'internal', 'restricted'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_TIERS)[number];

export const CONFIDENTIALITY_LABELS: Record<Confidentiality, string> = {
  public: 'Public — any recipient scope',
  internal: 'Internal — engineer and manager scopes',
  restricted: 'Restricted — team only, never delivered',
};

export const CONFIDENTIALITY_DESCRIPTIONS: Record<Confidentiality, string> = {
  public: 'Safe to hand to any incoming person.',
  internal: 'Withheld from coordinator and general scopes.',
  restricted: 'Never appears in a recipient view or a delivery link; only the project team sees it.',
};

/**
 * Restricted sources are team-only by design; internal sources are hidden from
 * the narrowest scopes. Applied to recipient views, delivery links and the
 * assistant alike.
 */
export function tierVisibleToScope(tier: Confidentiality, scope: RecipientScope): boolean {
  if (tier === 'restricted') return false;
  if (tier === 'public') return true;
  return scope === 'engineer' || scope === 'manager';
}

export interface ProjectSource {
  id: string;
  project_id: string;
  title: string;
  filename: string;
  byte_size: number;
  status: SourceStatus;
  error: string | null;
  chunk_count: number;
  kind: SourceKind;
  external_ref: string | null;
  confidentiality: Confidentiality;
  last_synced_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export const CLAIM_CATEGORIES = [
  'decision',
  'completed',
  'pending',
  'next_action',
  'owner',
  'contact',
  'risk',
  'blocker',
  'dependency',
  'setup',
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const CLAIM_STATUSES = ['supported', 'needs_review', 'conflicting', 'unsupported'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const REVIEW_STATES = ['pending', 'verified', 'excluded', 'redacted'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export interface ClaimEvidence {
  source_id: string;
  source_title: string;
  chunk_id: string;
  location: string;
  quote: string | null;
}

export interface ClaimCorroboration {
  claim_id: string;
  source_title: string;
  source_kind: SourceKind;
}

export interface Claim {
  id: string;
  project_id: string;
  category: ClaimCategory;
  text: string;
  original_text: string;
  reasoning: string | null;
  owner_text: string | null;
  status: ClaimStatus;
  confidence: number;
  conflict_group: string | null;
  review_state: ReviewState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  evidence: ClaimEvidence;
  source_kind: SourceKind;
  confidentiality: Confidentiality;
  /** Date the source itself states (commit or issue date), when known. */
  occurred_at: string | null;
  /** Claims from a different source kind that state the same thing. */
  corroborations: ClaimCorroboration[];
  created_at: string;
}

export const OWNER_UNCONFIRMED = 'Owner not confirmed';

// ---------------------------------------------------------------------------
// Handover sections
// ---------------------------------------------------------------------------

export const SECTION_KEYS = [
  'overview',
  'completed',
  'pending',
  'decisions',
  'ownership',
  'risks',
  'dependencies',
  'next_actions',
  'open_questions',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  overview: 'Project overview',
  completed: 'Completed work',
  pending: 'Pending work',
  decisions: 'Key decisions',
  ownership: 'Ownership',
  risks: 'Risks and blockers',
  dependencies: 'Dependencies',
  next_actions: 'Next actions',
  open_questions: 'Open questions',
};

export const SECTION_BLURBS: Record<SectionKey, string> = {
  overview: 'What the project does, its current phase and how it is set up.',
  completed: 'Work the sources describe as done.',
  pending: 'Open tasks and unfinished deliverables.',
  decisions: 'Choices that shaped the project, with the reason where recorded.',
  ownership: 'Who owns what, where the sources name a person.',
  risks: 'Known risks, blockers and unverified assumptions.',
  dependencies: 'Systems, people and approvals other work relies on.',
  next_actions: 'Prioritised steps for the incoming person.',
  open_questions: 'Gaps and contradictions that need a human answer.',
};

const SECTION_FOR_CATEGORY: Record<ClaimCategory, SectionKey> = {
  decision: 'decisions',
  completed: 'completed',
  pending: 'pending',
  next_action: 'next_actions',
  owner: 'ownership',
  contact: 'ownership',
  risk: 'risks',
  blocker: 'risks',
  dependency: 'dependencies',
  setup: 'overview',
};

export function sectionForCategory(category: ClaimCategory): SectionKey {
  return SECTION_FOR_CATEGORY[category];
}

/**
 * Section visibility per incoming role. The server is the only authority here:
 * the client never sends a scope, it is read from the member's row.
 */
export const SECTIONS_BY_SCOPE: Record<RecipientScope, SectionKey[]> = {
  engineer: [...SECTION_KEYS],
  manager: [
    'overview',
    'completed',
    'pending',
    'decisions',
    'ownership',
    'risks',
    'dependencies',
    'next_actions',
    'open_questions',
  ],
  coordinator: ['overview', 'pending', 'ownership', 'dependencies', 'next_actions', 'open_questions'],
  general: ['overview', 'pending', 'next_actions'],
};

export interface HandoverSection {
  key: SectionKey;
  title: string;
  blurb: string;
  claims: HandoverClaim[];
}

/** A frozen claim inside an approved handover snapshot. */
export interface HandoverClaim {
  id: string;
  category: ClaimCategory;
  text: string;
  status: ClaimStatus;
  owner_text: string | null;
  review_state: ReviewState;
  evidence: ClaimEvidence;
  source_kind: SourceKind;
  confidentiality: Confidentiality;
  occurred_at: string | null;
}

export interface HandoverVersion {
  id: string;
  project_id: string;
  version: number;
  status: 'draft' | 'approved' | 'rejected' | 'superseded';
  note: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface HandoverDetail extends HandoverVersion {
  project: { id: string; name: string };
  sections: HandoverSection[];
  stats: { total: number; supported: number; needs_review: number; conflicting: number; excluded: number; redacted: number };
  acknowledgements: { user_id: string; display_name: string | null; acknowledged_at: string }[];
}

export interface RecipientView {
  handover: { id: string; version: number; approved_at: string; status: string };
  project: { id: string; name: string };
  scope: RecipientScope;
  scope_note: string;
  sections: HandoverSection[];
  hidden_claim_count: number;
  acknowledged_at: string | null;
  reviewer_note: string | null;
}

export interface AuditEntry {
  id: string;
  project_id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface ExtractionSummary {
  chunks: number;
  claims_created: number;
  duplicates_skipped: number;
  conflicts: number;
  unsupported: number;
  needs_review: number;
  owner_gaps: number;
  sources_failed: string[];
  /** True when the run regenerated claims for passages that already had them. */
  refreshed: boolean;
  /** Reviewer decisions (verified, corrected, redacted, excluded) carried over. */
  reviews_preserved: number;
  /** Reviewer decisions that could not be matched to a new claim. */
  reviews_reset: number;
}

// ---------------------------------------------------------------------------
// Version comparison and rollback
// ---------------------------------------------------------------------------

export interface HandoverDiffClaim {
  id: string;
  category: ClaimCategory;
  text: string;
  evidence: ClaimEvidence;
  source_kind: SourceKind;
}

export interface HandoverDiffChanged {
  id: string;
  category: ClaimCategory;
  from_text: string;
  to_text: string;
  evidence: ClaimEvidence;
}

export interface HandoverDiff {
  from: { id: string; version: number; approved_at: string | null };
  to: { id: string; version: number; approved_at: string | null };
  added: HandoverDiffClaim[];
  removed: HandoverDiffClaim[];
  changed: HandoverDiffChanged[];
  unchanged: number;
}

// ---------------------------------------------------------------------------
// Delivered handover: expiring signed links
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'active' | 'expired' | 'revoked';

export interface DeliveryAcknowledgement {
  name: string;
  email: string | null;
  acknowledged_at: string;
}

export interface DeliveryLink {
  id: string;
  handover_id: string;
  project_id: string;
  scope: RecipientScope;
  recipient_label: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_at: string | null;
  open_count: number;
  created_at: string;
  status: DeliveryStatus;
  /** Full URL to hand to the recipient; only returned while the link is usable. */
  url: string | null;
  token: string | null;
  acknowledgement: DeliveryAcknowledgement | null;
  needs_reminder: boolean;
}

export interface DeliveryView {
  delivery: {
    scope: RecipientScope;
    recipient_label: string | null;
    expires_at: string;
  };
  handover: { id: string; version: number; approved_at: string | null; status: string };
  project: { id: string; name: string; description: string };
  sections: HandoverSection[];
  hidden_claim_count: number;
  scope_note: string;
  acknowledged_at: string | null;
  reviewer_note: string | null;
}

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export interface AssistantCitation {
  claim_id: string;
  text: string;
  category: ClaimCategory;
  source_title: string;
  source_kind: SourceKind;
  location: string;
  quote: string | null;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: AssistantCitation[] | null;
  created_at: string;
}

export interface AssistantReply {
  message: AssistantMessage;
  /** False when the knowledge base had no answer and the assistant said so. */
  grounded: boolean;
  context_claims: number;
  hidden_by_scope: number;
}

export const SCOPE_DESCRIPTIONS: Record<RecipientScope, string> = {
  engineer: 'Full technical view: every section, including decisions and setup detail.',
  manager: 'Delivery view: overview, decisions, ownership, risks, dependencies and next actions.',
  coordinator: 'Coordination view: pending work, ownership, dependencies and next actions.',
  general: 'Minimal view: overview, pending work and next actions.',
};
