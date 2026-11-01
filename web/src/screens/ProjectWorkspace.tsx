/**
 * Project workspace: the whole Connect -> Reconstruct -> Verify flow
 * (doc §2.2) plus members and audit. Review happens in HandoverEditor;
 * recipients get the RecipientView screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ClaimWithEvidence,
  Handover,
  Project,
  Source,
  AuditEntry,
} from '@knowbridge/shared';
import { get, post, del, patch, ApiError } from '../api';
import { Header } from './ProjectsScreen';
import { useAuth } from '../auth';
import { MapNode, CATEGORY_LABEL } from '../components/ClaimNodes';
import ClaimInspector from '../components/ClaimInspector';

interface MemberRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: 'manager' | 'reviewer' | 'recipient';
  user_id: string;
}

const TABS = ['sources', 'map', 'claims', 'handovers', 'members', 'audit'] as const;
type Tab = (typeof TABS)[number];

export default function ProjectWorkspace() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [myRole, setMyRole] = useState<'manager' | 'reviewer' | 'recipient' | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [claims, setClaims] = useState<ClaimWithEvidence[] | null>(null);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sources');
  const [busy, setBusy] = useState<string | null>(null);
  const [inspected, setInspected] = useState<ClaimWithEvidence | null>(null);

  const canEdit = myRole === 'manager' || myRole === 'reviewer';

  const loadCore = useCallback(async () => {
    const { project, members } = await get<{ project: Project; members: MemberRow[] }>(
      `/projects/${projectId}`,
    );
    setProject(project);
    setMembers(members);
    const { sources: s } = await get<{ sources: Source[] }>(`/projects/${projectId}/sources`);
    setSources(s);
    const { handovers: h } = await get<{ handovers: Handover[] }>(`/projects/${projectId}/handovers`);
    setHandovers(h);
    const { claims: c } = await get<{ claims: ClaimWithEvidence[] }>(
      `/projects/${projectId}/claims`,
    );
    setClaims(c);
    setMyRole(user ? members.find((m) => m.user_id === user.id)?.role ?? null : null);
  }, [projectId, user]);

  useEffect(() => {
    void (async () => {
      try {
        await loadCore();
      } catch (err) {
        setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
      }
    })();
  }, [loadCore]);

  async function runAction(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header user={null} />
      <div className="container">
        <div className="muted small" style={{ marginBottom: 6 }}>
          <Link to="/">← All projects</Link>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: '0' }}>{project ? project.name : '…'}</h2>
          <div className="row" style={{ flex: 'none', gap: 8 }}>
            {myRole && <span className="badge cat">you: {myRole}</span>}
            {canEdit && (
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  runAction('extract', async () => {
                    const { summary } = await post<{ summary: Record<string, number> }>(
                      `/projects/${projectId}/extract`,
                      {},
                    );
                    setNotice(
                      `Extraction done — ${summary.claims_created} claims, ${summary.claims_conflicting} conflicts, ${summary.unsupported_flagged} without evidence (deduped ${summary.deduped}).`,
                    );
                    await loadCore();
                    setTab('map');
                  })
                }
              >
                {busy === 'extract' ? (
                  <>
                    <span className="spin" /> Reconstructing…
                  </>
                ) : (
                  '▶ Run AI extraction'
                )}
              </button>
            )}
          </div>
        </div>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'sources' && (
          <SourcesTab
            projectId={projectId}
            sources={sources}
            canEdit={canEdit}
            busy={busy}
            runAction={runAction}
            onReload={loadCore}
          />
        )}
        {tab === 'map' && (
          <ContinuityMap claims={claims} onOpen={setInspected} canEdit={canEdit} />
        )}
        {tab === 'claims' && (
          <ClaimsTab claims={claims} canEdit={canEdit} onOpen={setInspected} />
        )}
        {tab === 'handovers' && (
          <HandoversTab
            projectId={projectId}
            handovers={handovers}
            myRole={myRole}
            canEdit={canEdit}
            busy={busy}
            runAction={runAction}
            onReload={loadCore}
          />
        )}
        {tab === 'members' && (
          <MembersTab
            projectId={projectId}
            members={members}
            myRole={myRole}
            onReload={loadCore}
            busy={busy}
            runAction={runAction}
          />
        )}
        {tab === 'audit' && (
          <AuditTab projectId={projectId} audit={audit} canEdit={canEdit} />
        )}
      </div>
      <ClaimInspector claim={inspected} onClose={() => setInspected(null)}>
        {inspected && canEdit && (
          <div className="row" style={{ flex: 'none', marginTop: 10 }}>
            <button
              className="btn secondary small"
              onClick={async () => {
                await patch(`/claims/${inspected.id}`, { status: 'supported' });
                setInspected(null);
                await loadCore();
              }}
            >
              Mark verified by reviewer
            </button>
            <button
              className="btn danger small"
              onClick={async () => {
                await del(`/claims/${inspected.id}`);
                setInspected(null);
                await loadCore();
              }}
            >
              Delete claim
            </button>
          </div>
        )}
      </ClaimInspector>
      <button
        className="btn secondary small"
        style={{ position: 'fixed', right: 16, bottom: 16 }}
        onClick={() => nav('/')}
      >
        Done
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesTab({
  projectId,
  sources,
  canEdit,
  busy,
  runAction,
  onReload,
}: {
  projectId: string;
  sources: Source[];
  canEdit: boolean;
  busy: string | null;
  runAction: (key: string, fn: () => Promise<void>) => void;
  onReload: () => Promise<void>;
}) {
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');

  return (
    <>
      {canEdit && (
        <div className="panel">
          <h3>Connect sources</h3>
          <label>Upload documents (PDF, DOCX, TXT, MD — up to 10 files)</label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              const form = new FormData();
              for (const f of Array.from(files)) form.append('files', f);
              void runAction('upload', async () => {
                await post(`/projects/${projectId}/sources/upload`, form);
                await onReload();
              });
            }}
          />
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <div>
              <label>GitHub repo (read-only)</label>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
              />
            </div>
            <div>
              <label>Token (optional, never stored)</label>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… for private repos"
                type="password"
              />
            </div>
            <div style={{ flex: 'none' }}>
              <button
                className="btn secondary"
                disabled={busy !== null || !/^[\w.-]+\/[\w.-]+$/.test(repo)}
                onClick={() =>
                  runAction('gh', async () => {
                    await post(`/projects/${projectId}/sources/github`, {
                      repo,
                      ...(token ? { token } : {}),
                    });
                    setToken('');
                    await onReload();
                  })
                }
              >
                {busy === 'gh' ? 'Fetching…' : 'Connect repo'}
              </button>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            The repo is snapshotted read-only (README, docs, open issues, recent commits). Your
            token is used at connect time and never persisted (doc §3.5).
          </p>
        </div>
      )}
      {sources.length === 0 ? (
        <div className="panel muted">No sources yet — upload a document or connect a repo.</div>
      ) : (
        <div className="panel">
          <h3>Sources ({sources.length})</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Ref</th>
                <th>Added</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.external_ref ?? '#'} target="_blank" rel="noreferrer" onClick={s.type === 'document' ? (e) => e.preventDefault() : undefined}>
                      {s.title}
                    </a>
                  </td>
                  <td>
                    <span className="badge cat">{s.type}</span>
                  </td>
                  <td className="muted small">{s.external_ref?.slice(0, 40) ?? '—'}</td>
                  <td className="muted small">{new Date(s.created_at).toLocaleDateString()}</td>
                  {canEdit && (
                    <td>
                      <button
                        className="btn danger small"
                        onClick={() =>
                          runAction(`del-${s.id}`, async () => {
                            await del(`/projects/${projectId}/sources/${s.id}`);
                            await onReload();
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Continuity Map
// ---------------------------------------------------------------------------

function ContinuityMap({
  claims,
  onOpen,
  canEdit,
}: {
  claims: ClaimWithEvidence[] | null;
  onOpen: (c: ClaimWithEvidence) => void;
  canEdit: boolean;
}) {
  if (claims === null) return <p className="muted">Loading knowledge…</p>;
  if (claims.length === 0) {
    return (
      <div className="panel muted">
        The Knowledge Continuity Map fills in after you connect sources and run AI extraction.
      </div>
    );
  }
  const sections = ['decision', 'task', 'risk', 'dependency', 'owner', 'setup', 'contact', 'other'] as const;
  return (
    <>
      {sections.map((section) => {
        const items = claims.filter((c) => c.category === section);
        if (items.length === 0) return null;
        return (
          <div key={section} className="map-section">
            <h3>
              {CATEGORY_LABEL[section]} <span className="muted small">({items.length})</span>
            </h3>
            <div className="map-column">
              {items.map((c) => (
                <MapNode key={c.id} claim={c} onOpen={onOpen} />
              ))}
            </div>
          </div>
        );
      })}
      {canEdit && (
        <p className="muted small">
          Evidence-first: click any node to inspect its source quotes and links unsupported
          statements stay marked instead of being presented as fact (doc §3.4).
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Claims table
// ---------------------------------------------------------------------------

function ClaimsTab({
  claims,
  canEdit,
  onOpen,
}: {
  claims: ClaimWithEvidence[] | null;
  canEdit: boolean;
  onOpen: (c: ClaimWithEvidence) => void;
}) {
  if (claims === null) return <p className="muted">Loading claims…</p>;
  if (claims.length === 0) return <div className="panel muted">No claims extracted yet.</div>;
  return (
    <div className="panel">
      <table className="table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Category</th>
            <th>Claim</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(c)}>
              <td>
                <span className={`badge ${c.status}`}>{c.status}</span>
              </td>
              <td>
                <span className="badge cat">{c.category}</span>
              </td>
              <td>{c.text}</td>
              <td className="muted small">{c.evidence.length ? `${c.evidence.length} source(s)` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!canEdit && (
        <p className="muted small">Recipients see the approved handover in the Handovers tab.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handovers
// ---------------------------------------------------------------------------

function HandoversTab(props: {
  projectId: string;
  handovers: Handover[];
  myRole: string | null;
  canEdit: boolean;
  busy: string | null;
  runAction: (key: string, fn: () => Promise<void>) => void;
  onReload: () => Promise<void>;
}) {
  const { projectId, handovers, myRole, canEdit, busy, runAction, onReload } = props;
  return (
    <>
      {canEdit && (
        <button
          className="btn"
          disabled={busy !== null}
          onClick={() =>
            runAction('handover', async () => {
              await post(`/projects/${projectId}/handover`, {});
              await onReload();
            })
          }
        >
          {busy === 'handover' ? 'Creating…' : '+ New draft handover'}
        </button>
      )}
      {handovers.length === 0 ? (
        <div className="panel muted" style={{ marginTop: 12 }}>
          No handovers yet.
        </div>
      ) : (
        <div className="panel" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
                <th>Approved</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {handovers.map((h) => (
                <tr key={h.id}>
                  <td>v{h.version}</td>
                  <td>
                    <span className={`badge ${h.status === 'approved' ? 'supported' : h.status === 'rejected' ? 'unsupported' : 'needs_review'}`}>
                      {h.status}
                    </span>
                  </td>
                  <td className="muted small">{new Date(h.created_at).toLocaleString()}</td>
                  <td className="muted small">{h.approved_at ? new Date(h.approved_at).toLocaleString() : '—'}</td>
                  <td>
                    {h.status === 'draft' && canEdit ? (
                      <Link className="btn small" to={`/handovers/${h.id}/review`}>
                        Review & approve
                      </Link>
                    ) : h.status === 'approved' ? (
                      <Link className="btn secondary small" to={`/handovers/${h.id}/recipient`}>
                        {myRole === 'recipient' ? 'Open handover' : 'Recipient view'}
                      </Link>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MembersTab({
  projectId,
  members,
  myRole,
  runAction,
  onReload,
  busy,
}: {
  projectId: string;
  members: MemberRow[];
  myRole: string | null;
  busy: string | null;
  runAction: (key: string, fn: () => Promise<void>) => void;
  onReload: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'reviewer' | 'recipient'>('recipient');
  const isManager = myRole === 'manager';
  return (
    <div className="panel">
      <h3>Members</h3>
      {isManager && (
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <label>Add by email (must be a registered user)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="incoming.person@team.example" />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="recipient">recipient</option>
              <option value="reviewer">reviewer</option>
              <option value="manager">manager</option>
            </select>
          </div>
          <div style={{ flex: 'none' }}>
            <button
              className="btn secondary"
              disabled={!email || busy !== null}
              onClick={() =>
                runAction('member', async () => {
                  await post(`/projects/${projectId}/members`, { email: email.trim().toLowerCase(), role });
                  setEmail('');
                  await onReload();
                })
              }
            >
              Add member
            </button>
          </div>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.display_name ?? '—'}</td>
              <td className="muted small">{m.email}</td>
              <td>
                <span className="badge cat">{m.role}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function AuditTab({ projectId, audit, canEdit }: { projectId: string; audit: AuditEntry[]; canEdit: boolean }) {
  useEffect(() => {
    if (!canEdit) return;
    void get<{ audit: AuditEntry[] }>(`/projects/${projectId}/audit`)
      .then((r) => audit)
      .catch(() => undefined);
  }, [projectId, audit, canEdit]);
  return (
    <div className="panel">
      <h3>Audit trail</h3>
      <AuditList projectId={projectId} canEdit={canEdit} />
    </div>
  );
}

function AuditList({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => {
    if (!canEdit) return;
    void get<{ audit: AuditEntry[] }>(`/projects/${projectId}/audit`).then((r) => setRows(r.audit));
  }, [projectId, canEdit]);
  if (!canEdit) return <p className="muted small">Audit is visible to managers and reviewers.</p>;
  if (rows.length === 0) return <p className="muted small">No audit entries yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>When</th>
          <th>Who</th>
          <th>Action</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="muted small">{new Date(a.created_at).toLocaleString()}</td>
            <td className="muted small">{a.actor_email ?? a.actor_id.slice(0, 8)}</td>
            <td>
              <span className="badge cat">{a.action}</span>
            </td>
            <td className="muted small">
              <code>{JSON.stringify(a.detail)}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
