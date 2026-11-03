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

export interface ProjectSource {
  id: string;
  project_id: string;
  title: string;
  filename: string;
  byte_size: number;
  status: SourceStatus;
  error: string | null;
  chunk_count: number;
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
}

export const SCOPE_DESCRIPTIONS: Record<RecipientScope, string> = {
  engineer: 'Full technical view: every section, including decisions and setup detail.',
  manager: 'Delivery view: overview, decisions, ownership, risks, dependencies and next actions.',
  coordinator: 'Coordination view: pending work, ownership, dependencies and next actions.',
  general: 'Minimal view: overview, pending work and next actions.',
};
