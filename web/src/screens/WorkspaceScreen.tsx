import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuditEntry,
  Claim,
  CONFIDENTIALITY_DESCRIPTIONS,
  CONFIDENTIALITY_TIERS,
  Confidentiality,
  ExtractionSummary,
  HandoverVersion,
  MemberRole,
  MEMBER_ROLES,
  OWNER_UNCONFIRMED,
  ProjectMember,
  ProjectSource,
  RecipientScope,
  RECIPIENT_SCOPES,
  SCOPE_DESCRIPTIONS,
  SECTION_KEYS,
  SECTION_TITLES,
  SectionKey,
  sectionForCategory,
} from '@knowbridge/shared';
import { api, ApiError } from '../api';
import ClaimCard from '../components/ClaimCard';
import HandoverPanel from './HandoverPanel';
import TimelinePanel from './TimelinePanel';
import AssistantPanel from './AssistantPanel';

type Tab = 'sources' | 'timeline' | 'map' | 'claims' | 'handover' | 'assistant' | 'members' | 'audit';

interface Detail {
  project: { id: string; name: string; description: string; created_at: string };
  members: ProjectMember[];
  my_role: MemberRole;
  my_scope: RecipientScope;
  counts: { sources: number; claims: number };
}

const CATEGORY_FILTERS = ['all', 'decision', 'pending', 'next_action', 'owner', 'risk', 'dependency', 'setup', 'other'];
const STATUS_FILTERS = ['all', 'supported', 'needs_review', 'conflicting', 'unsupported'];

export default function WorkspaceScreen({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>('sources');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [sources, setSources] = useState<ProjectSource[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [handovers, setHandovers] = useState<HandoverVersion[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ExtractionSummary | null>(null);
  const [uploadErrors, setUploadErrors] = useState<{ filename: string; error: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [uploadTier, setUploadTier] = useState<Confidentiality>('internal');
  const [repoInput, setRepoInput] = useState('');
  const [repoNotes, setRepoNotes] = useState<string[]>([]);
  const [repoBusy, setRepoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detailData, sourceData, claimData, handoverData] = await Promise.all([
        api<Detail>(`/projects/${projectId}`),
        api<{ sources: ProjectSource[] }>(`/projects/${projectId}/sources`),
        api<{ claims: Claim[] }>(`/projects/${projectId}/claims`),
        api<{ handovers: HandoverVersion[] }>(`/projects/${projectId}/handovers`),
      ]);
      setDetail(detailData);
      setSources(sourceData.sources);
      setClaims(claimData.claims);
      setHandovers(handoverData.handovers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [projectId]);

  const loadAudit = useCallback(async () => {
    try {
      const data = await api<{ entries: AuditEntry[] }>(`/projects/${projectId}/audit`);
      setAudit(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'audit') void loadAudit();
  }, [tab, loadAudit]);

  const canReview = detail ? ['manager', 'reviewer'].includes(detail.my_role) : false;
  const canApprove = detail?.my_role === 'manager';

  const groups = useMemo(
    () =>
      SECTION_KEYS.map((key) => ({
        key,
        claims: claims
          .filter((c) => c.review_state !== 'excluded')
          .filter((c) => sectionForCategory(c.category) === key),
      })).filter((g) => g.claims.length > 0),
    [claims],
  );

  const filteredClaims = useMemo(
    () =>
      claims.filter((claim) => {
        const statusOk = statusFilter === 'all' || claim.status === statusFilter;
        const categoryOk =
          categoryFilter === 'all' ||
          (categoryFilter === 'other'
            ? !['decision', 'pending', 'next_action', 'owner', 'risk', 'dependency', 'setup'].includes(claim.category)
            : claim.category === categoryFilter);
        return statusOk && categoryOk;
      }),
    [claims, statusFilter, categoryFilter],
  );

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;
    const form = new FormData();
    for (const file of Array.from(files)) form.append('files', file);
    form.append('confidentiality', uploadTier);

    setBusy(true);
    setError(null);
    setMessage(null);
    setUploadErrors([]);
    try {
      const data = await api<{ sources: ProjectSource[]; errors: { filename: string; error: string }[] }>(
        `/projects/${projectId}/sources`,
        { method: 'POST', body: form },
      );
      setMessage(`${data.sources.length} document(s) ingested.`);
      setUploadErrors(data.errors);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  async function connectRepo() {
    if (repoInput.trim().length < 3) return;
    setRepoBusy(true);
    setError(null);
    setMessage(null);
    setRepoNotes([]);
    try {
      const data = await api<{
        repo: string;
        sources: ProjectSource[];
        notes: string[];
        replaced: number;
      }>(`/projects/${projectId}/sources/github`, {
        method: 'POST',
        body: JSON.stringify({ repo: repoInput.trim(), confidentiality: uploadTier }),
      });
      setMessage(
        `${data.sources.length} source(s) connected from ${data.repo}${
          data.replaced ? `, replacing ${data.replaced} older one(s)` : ''
        }. Run extraction to merge them with your documents.`,
      );
      setRepoNotes(data.notes);
      setRepoInput('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRepoBusy(false);
    }
  }

  async function setSourceTier(sourceId: string, tier: Confidentiality) {
    try {
      await api(`/projects/${projectId}/sources/${sourceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ confidentiality: tier }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function extract(refresh = false) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await api<{ summary: ExtractionSummary }>(`/projects/${projectId}/extract`, {
        method: 'POST',
        body: JSON.stringify({ refresh }),
      });
      setSummary(data.summary);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(sourceId: string) {
    if (!window.confirm('Remove this source and every claim extracted from it?')) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/sources/${sourceId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <div className="empty">
        {error ? error : <><span className="spinner" /> Opening project…</>}
      </div>
    );
  }

  const conflicts = claims.filter((c) => c.status === 'conflicting');
  const gaps = claims.filter((c) => c.owner_text === OWNER_UNCONFIRMED);
  const unsupported = claims.filter((c) => c.status === 'unsupported');
  const approved = handovers.find((h) => h.status === 'approved');

  return (
    <>
      <a className="back" href="#/">
        ← All projects
      </a>
      <div className="page-head">
        <div>
          <h1>{detail.project.name}</h1>
          <p className="muted small">{detail.project.description || 'No description'}</p>
          <div className="pill-row" style={{ marginTop: 8 }}>
            <span className="badge cat">you · {detail.my_role}</span>
            <span className="badge">scope · {detail.my_scope}</span>
            {approved && (
              <a className="badge supported" href={`#/handover/${approved.id}`}>
                v{approved.version} approved →
              </a>
            )}
          </div>
        </div>
        {canReview && (
          <div className="pill-row">
            <button className="primary" disabled={busy || !sources.length} onClick={() => void extract() }>
              {busy ? 'Working…' : '▶ Run AI extraction'}
            </button>
            <button
              className="ghost"
              disabled={busy || !sources.length}
              title="Regenerate every passage, keeping each reviewer decision"
              onClick={() => void extract(true)}
            >
              ↻ Refresh all
            </button>
          </div>
        )}
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 14 }}>{error}</div>}
      {message && <div className="notice ok" style={{ marginBottom: 14 }}>{message}</div>}
      {summary && (
        <div className="notice" style={{ marginBottom: 14 }}>
          {summary.refreshed ? 'Refresh finished' : 'Extraction finished'} — {summary.claims_created} new claim(s)
          from {summary.chunks} passages · {summary.conflicts} conflict(s) · {summary.needs_review} need review ·{' '}
          {summary.unsupported} without a verbatim quote · {summary.duplicates_skipped} duplicate(s) skipped ·{' '}
          {summary.owner_gaps} ownership gap(s).
          {summary.refreshed && (
            <span className="muted">
              {' '}
              Reviewer decisions carried over: {summary.reviews_preserved}
              {summary.reviews_reset > 0 ? ` · ${summary.reviews_reset} could not be matched and need another look` : ''}.
            </span>
          )}
          {summary.sources_failed.length > 0 && (
            <span className="muted"> Failed: {summary.sources_failed.join('; ')}</span>
          )}
        </div>
      )}
      {uploadErrors.length > 0 && (
        <div className="notice bad" style={{ marginBottom: 14 }}>
          {uploadErrors.map((e) => (
            <div key={e.filename}>
              <strong>{e.filename}</strong> — {e.error}
            </div>
          ))}
        </div>
      )}

      <nav className="tabs">
        {(
          [
            ['sources', `Sources (${sources.length})`],
            ['timeline', 'Timeline'],
            ['map', 'Map'],
            ['claims', `Claims (${claims.length})`],
            ['handover', 'Handover'],
            ['assistant', 'AI Assistant'],
            ['members', `Members (${detail.members.length})`],
            ['audit', 'Audit'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'sources' && (
        <div className="stack" style={{ gap: 18 }}>
          {canReview ? (
            <>
              <div className="grid cols-2">
                <section className="card pad-lg stack">
                  <h3>Connect authorised documents</h3>
                  <p className="muted small">
                    PDF, DOCX, TXT or MD, up to 10 files at a time (15 MB each). Documents are chunked and
                    every extracted claim must quote a passage from its chunk.
                  </p>
                  <div>
                    <label htmlFor="upload-tier">Confidentiality of these files</label>
                    <select
                      id="upload-tier"
                      value={uploadTier}
                      onChange={(e) => setUploadTier(e.target.value as Confidentiality)}
                    >
                      {CONFIDENTIALITY_TIERS.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier}
                        </option>
                      ))}
                    </select>
                    <p className="muted tiny" style={{ marginTop: 4 }}>
                      {CONFIDENTIALITY_DESCRIPTIONS[uploadTier]}
                    </p>
                  </div>
                  <label className="dropzone" style={{ cursor: 'pointer' }}>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.txt,.md,.markdown"
                      hidden
                      onChange={upload}
                      disabled={busy}
                    />
                    {busy ? 'Processing…' : 'Click to choose documents'}
                  </label>
                </section>

                <section className="card pad-lg stack">
                  <h3>Connect a GitHub repository</h3>
                  <p className="muted small">
                    Read-only. README, open and closed issues, and recent commits become a second source type,
                    with each claim quoting the issue or commit it came from.
                  </p>
                  <div>
                    <label htmlFor="repo-input">Repository</label>
                    <input
                      id="repo-input"
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      placeholder="owner/name or https://github.com/owner/name"
                      disabled={repoBusy}
                    />
                  </div>
                  <div className="row">
                    <button
                      className="primary"
                      disabled={repoBusy || repoInput.trim().length < 3}
                      onClick={() => void connectRepo()}
                    >
                      {repoBusy ? 'Reading repository…' : 'Connect repository'}
                    </button>
                    <span className="muted tiny">Uses the confidentiality tier selected on the left.</span>
                  </div>
                  {repoNotes.length > 0 && (
                    <div className="notice">{repoNotes.join(' · ')}</div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="notice">Only a manager or reviewer can add sources.</div>
          )}

          <section className="card pad-lg stack">
            <h3>Sources ({sources.length})</h3>
            {sources.length === 0 ? (
              <p className="muted small">No documents yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Type</th>
                    <th>Confidentiality</th>
                    <th>Status</th>
                    <th>Passages</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <strong>{source.title}</strong>
                        <div className="muted tiny mono">{source.external_ref ?? source.filename}</div>
                      </td>
                      <td>
                        <span className={`badge ${source.kind === 'github' ? 'supported' : 'cat'}`}>
                          {source.kind}
                        </span>
                      </td>
                      <td>
                        {canApprove ? (
                          <select
                            value={source.confidentiality}
                            disabled={busy}
                            style={{ width: 130 }}
                            onChange={(e) => void setSourceTier(source.id, e.target.value as Confidentiality)}
                          >
                            {CONFIDENTIALITY_TIERS.map((tier) => (
                              <option key={tier} value={tier}>
                                {tier}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="badge">{source.confidentiality}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${source.status === 'ready' ? 'supported' : 'excluded'}`}>
                          {source.status}
                        </span>
                        {source.error && <div className="muted tiny">{source.error}</div>}
                      </td>
                      <td className="muted small">{source.chunk_count}</td>
                      <td className="muted small">{new Date(source.created_at).toLocaleDateString()}</td>
                      <td>
                        {canApprove && (
                          <button className="ghost small danger" disabled={busy} onClick={() => void removeSource(source.id)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {tab === 'timeline' && <TimelinePanel claims={claims} />}

      {tab === 'map' && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="grid cols-3">
            <div className="card">
              <div className="stat">
                <span className="muted tiny">Extracted claims</span>
                <strong>{claims.length}</strong>
                <span className="muted tiny">{unsupported.length} without a verbatim quote</span>
              </div>
            </div>
            <div className="card">
              <div className="stat">
                <span className="muted tiny">Contradictions</span>
                <strong>{conflicts.length}</strong>
                <span className="muted tiny">opposite claims, both kept for review</span>
              </div>
            </div>
            <div className="card">
              <div className="stat">
                <span className="muted tiny">Ownership gaps</span>
                <strong>{gaps.length}</strong>
                <span className="muted tiny">decisions with no owner in the text</span>
              </div>
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="notice warn">
              <strong>Conflicting statements found.</strong> The reviewer must resolve these; KnowBridge does
              not pick a winner.
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {conflicts.map((c) => (
                  <li key={c.id} className="small">
                    {c.text} <span className="muted">({c.evidence.source_title})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {groups.length === 0 && (
            <div className="empty">
              <strong>The map is empty</strong>
              <p className="small">Upload documents and run extraction to build the continuity map.</p>
            </div>
          )}

          {groups.map((group) => (
            <section key={group.key} className="stack">
              <div className="section-title">
                <h3>{SECTION_TITLES[group.key as SectionKey]}</h3>
                <span className="badge cat">{group.claims.length}</span>
              </div>
              <div className="grid cols-3">
                {group.claims.map((claim) => (
                  <div key={claim.id} className="claim-card">
                    <div className="pill-row">
                      <span className="badge cat">{claim.category.replace('_', ' ')}</span>
                      <span className={`badge ${claim.status}`}>{claim.status.replace('_', ' ')}</span>
                      {claim.conflict_group && <span className="badge conflicting">conflict</span>}
                    </div>
                    <p className="small">{claim.text}</p>
                    {claim.owner_text === OWNER_UNCONFIRMED && <span className="owner-gap">⚠ {OWNER_UNCONFIRMED}</span>}
                    <span className="muted tiny">
                      {claim.evidence.source_title} · {claim.evidence.location}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === 'claims' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 190 }}>
              <label htmlFor="status-filter">Status</label>
              <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: 190 }}>
              <label htmlFor="category-filter">Category</label>
              <select id="category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                {CATEGORY_FILTERS.map((c) => (
                  <option key={c} value={c}>
                    {c === 'all' ? 'All categories' : c.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <span className="muted small">{filteredClaims.length} shown</span>
          </div>

          {filteredClaims.length === 0 && (
            <div className="empty">
              <strong>No claims match</strong>
              <p className="small">Try another filter, or run extraction if the project has no claims yet.</p>
            </div>
          )}

          <div className="grid">
            {filteredClaims.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} canReview={canReview} onChange={() => void load()} />
            ))}
          </div>
        </div>
      )}

      {tab === 'handover' && (
        <HandoverPanel
          projectId={projectId}
          claims={claims}
          handovers={handovers}
          canApprove={Boolean(canApprove)}
          canReview={canReview}
          onChanged={() => void load()}
        />
      )}

      {tab === 'assistant' && <AssistantPanel projectId={projectId} />}

      {tab === 'members' && (
        <MembersTab
          projectId={projectId}
          members={detail.members}
          canManage={Boolean(canApprove)}
          onChanged={() => void load()}
        />
      )}

      {tab === 'audit' && (
        <section className="card pad-lg stack">
          <h3>Audit trail</h3>
          <p className="muted small">
            Every source connection, correction, approval, handover opening and acknowledgement is recorded.
          </p>
          {audit.length === 0 ? (
            <p className="muted small">Nothing recorded yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="muted small">{new Date(entry.created_at).toLocaleString()}</td>
                    <td className="small">{entry.actor_name ?? 'system'}</td>
                    <td>
                      <span className="badge cat">{entry.action}</span>
                    </td>
                    <td className="muted tiny mono">{entry.target_type}</td>
                    <td className="muted tiny mono" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>
                      {entry.detail ? JSON.stringify(entry.detail) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

function MembersTab({
  projectId,
  members,
  canManage,
  onChanged,
}: {
  projectId: string;
  members: ProjectMember[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('recipient');
  const [scope, setScope] = useState<RecipientScope>('general');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), role, scope }),
      });
      setEmail('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function update(memberId: string, body: { role?: MemberRole; scope?: RecipientScope }) {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      {error && <div className="notice bad">{error}</div>}

      {canManage && (
        <section className="card pad-lg stack">
          <h3>Add a member</h3>
          <p className="muted small">
            The person needs a KnowBridge account first. A recipient's scope decides which handover
            sections they see.
          </p>
          <div className="grid cols-3">
            <div>
              <label htmlFor="member-email">Email</label>
              <input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="incoming@knowbridge.demo"
              />
            </div>
            <div>
              <label htmlFor="member-role">Role</label>
              <select id="member-role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="member-scope">Scope</label>
              <select id="member-scope" value={scope} onChange={(e) => setScope(e.target.value as RecipientScope)}>
                {RECIPIENT_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <button className="primary" disabled={busy || !email.trim()} onClick={() => void add()}>
              Add member
            </button>
            <span className="muted tiny">{SCOPE_DESCRIPTIONS[scope]}</span>
          </div>
        </section>
      )}

      <section className="card pad-lg stack">
        <h3>Members ({members.length})</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Scope</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.display_name ?? member.email}</strong>
                  <div className="muted tiny">{member.email}</div>
                </td>
                <td>
                  {canManage ? (
                    <select
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => void update(member.id, { role: e.target.value as MemberRole })}
                      style={{ width: 130 }}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge cat">{member.role}</span>
                  )}
                </td>
                <td>
                  {canManage ? (
                    <select
                      value={member.scope}
                      disabled={busy}
                      onChange={(e) => void update(member.id, { scope: e.target.value as RecipientScope })}
                      style={{ width: 140 }}
                    >
                      {RECIPIENT_SCOPES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge">{member.scope}</span>
                  )}
                </td>
                <td className="muted small">{new Date(member.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
