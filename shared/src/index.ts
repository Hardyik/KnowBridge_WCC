/**
 * KnowBridge shared domain model.
 *
 * This package is the single source of truth for API payloads, database row
 * shapes and AI extraction schemas. Server, web client and any future mobile
 * client all import from here so the 4-person team can work in parallel
 * against one contract.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export const MemberRole = z.enum(['manager', 'reviewer', 'recipient']);
export type MemberRole = z.infer<typeof MemberRole>;

export interface Profile {
  id: string; // Supabase auth user id
  email: string;
  display_name: string;
  created_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: MemberRole;
  display_name?: string;
  email?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string; // created by (manager)
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SourceType = z.enum(['document', 'github']);
export type SourceType = z.infer<typeof SourceType>;

export const SourceStatus = z.enum(['processing', 'ready', 'failed']);
export type SourceStatus = z.infer<typeof SourceStatus>;

/**
 * A "piece" is one retrievable unit of a source: a page, a section heading,
 * an issue, a commit message. Every piece carries a location string that the
 * evidence layer links claims back to, plus an external URL when one exists
 * (GitHub issue URL etc.) so the reviewer can jump to the original.
 */
export interface SourcePiece {
  id: string;
  source_id: string;
  idx: number; // ordering within the source
  label: string; // human-readable location, e.g. "Architecture.pdf — page 3"
  location: string; // stable anchor, e.g. "page:3" or "issue:12" or "file:docs/api.md"
  text: string;
  url: string | null;
}

export interface Source {
  id: string;
  project_id: string;
  type: SourceType;
  title: string;
  status: SourceStatus;
  created_by: string;
  /** For github sources: "owner/repo". For documents: original filename. */
  external_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Claims — the recognised project knowledge
// ---------------------------------------------------------------------------

export const ClaimCategory = z.enum([
  'decision',
  'task',
  'risk',
  'dependency',
  'owner',
  'setup',
  'contact',
  'other',
]);
export type ClaimCategory = z.infer<typeof ClaimCategory>;

/**
 * Evidence status. `unsupported` means the model stated something with no
 * source behind it — it is never shown as fact and needs reviewer action.
 * `conflicting` means two sources (or the model and a source) disagree.
 */
export const ClaimStatus = z.enum(['supported', 'needs_review', 'conflicting', 'unsupported']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const REVIEW_NOTE = 'needs-review';
export const OWNER_UNCONFIRMED = 'Owner not confirmed';

export interface Claim {
  id: string;
  project_id: string;
  category: ClaimCategory;
  text: string;
  /** The "why" behind a decision — only ever set when a source states it. */
  reasoning: string | null;
  owner_text: string | null;
  status: ClaimStatus;
  /** 0..1 model self-assessment; informational only, never permission-driving. */
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ClaimEvidence {
  id: string;
  claim_id: string;
  source_id: string;
  piece_id: string | null;
  label: string;
  location: string;
  url: string | null;
  quote: string | null;
  created_at: string;
}

/** A claim joined with its evidence rows, as the API returns. */
export interface ClaimWithEvidence extends Claim {
  evidence: ClaimEvidence[];
}

// ---------------------------------------------------------------------------
// Handover versions
// ---------------------------------------------------------------------------

export const HandoverStatus = z.enum(['draft', 'approved', 'rejected']);
export type HandoverStatus = z.infer<typeof HandoverStatus>;

/**
 * Per-claim state inside a handover version. The reviewer can edit text,
 * reject a claim entirely, or redact it from recipient views.
 */
export interface HandoverClaimReview {
  claim_id: string;
  edited_text: string | null;
  action: 'include' | 'reject';
  redact_from_recipients: boolean;
  verified_by_reviewer: boolean;
}

export interface Handover {
  id: string;
  project_id: string;
  version: number;
  status: HandoverStatus;
  /** Snapshot of per-claim review state at save time. */
  claim_reviews: HandoverClaimReview[];
  /** Free-form reviewer note shown to recipients. */
  reviewer_note: string | null;
  created_by: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

// ---------------------------------------------------------------------------
// Recipients & acknowledgement
// ---------------------------------------------------------------------------

export const RecipientRoleTag = z.enum(['engineer', 'manager', 'coordinator', 'general']);
export type RecipientRoleTag = z.infer<typeof RecipientRoleTag>;

/**
 * Recipients see only: project-level handover sections, their role tag, and
 * claims that are included AND not redacted. Categories outside their scope
 * are additionally hidden role-appropriately.
 */
export interface Acknowledgement {
  id: string;
  handover_id: string;
  user_id: string;
  acknowledged_at: string;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  project_id: string;
  actor_id: string;
  actor_email: string | null;
  action: string; // e.g. "source.connect", "extraction.run", "handover.approve"
  detail: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GitHub connector
// ---------------------------------------------------------------------------

export interface GitHubConnectRequest {
  project_id: string;
  repo: string; // "owner/repo"
  /** Repo-scoped token, used at connection time only, never stored. */
  token?: string;
}

// ---------------------------------------------------------------------------
// AI extraction (Groq) — strict schema, validated before persisting
// ---------------------------------------------------------------------------

export interface ExtractionRequest {
  project_id: string;
}

export interface ExtractionResultSummary {
  pieces: number;
  claims_created: number;
  claims_conflicting: number;
  unsupported_flagged: number;
  deduped: number;
}

/**
 * What the model may emit per analysed piece. Anything outside this strict
 * shape is dropped. The model is instructed that emitting an owner that is
 * not in the text is forbidden; unknown owners must produce
 * `owner_text: null` and the system writes OWNER_UNCONFIRMED itself.
 */
export const ExtractedClaimSchema = z.object({
  category: ClaimCategory,
  text: z.string().min(1),
  reasoning: z.string().nullable().optional(),
  owner_text: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  unsupported: z.boolean().optional(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
}

export const HANDOVER_SECTIONS = [
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
export type HandoverSection = (typeof HANDOVER_SECTIONS)[number];

/** Which claim categories land in which handover report section. */
export const SECTION_BY_CATEGORY: Record<ClaimCategory, HandoverSection> = {
  decision: 'key_decisions',
  task: 'pending',
  risk: 'risks',
  dependency: 'dependencies',
  owner: 'ownership',
  setup: 'overview',
  contact: 'ownership',
  other: 'open_questions',
};

/** Recipient role tags scope which sections they can see. */
export const SECTIONS_BY_RECIPIENT_ROLE: Record<RecipientRoleTag, HandoverSection[] | 'all'> = {
  engineer: 'all',
  manager: 'all',
  coordinator: [
    'overview',
    'pending',
    'ownership',
    'next_actions',
    'open_questions',
  ],
  general: ['overview', 'next_actions'],
};
