/**
 * Read-only GitHub connector. Fetches a repo snapshot at connect time and
 * stores everything with resolvable URLs so every evidence link can be
 * opened by the reviewer. The token is used per call and NEVER stored
 * (doc §3.5: protected access tokens, delete/revocation story).
 *
 * Optional `token`: a repo-scoped PAT, needed only for private repos
 * or to avoid anonymous rate limits.
 */
import { IngestPiece } from './ingest/pdf.js';

const GH = 'https://api.github.com';

function ghHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'KnowBridge-MVP',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

interface GhRepo {
  html_url: string;
  full_name: string;
  description: string | null;
  default_branch: string;
}

interface GhFile {
  path: string;
  html_url: string;
  type: 'file' | 'dir';
}

interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  pull_request?: unknown;
}

interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null };
}

async function ghFetch<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${GH}${path}`, { headers: ghHeaders(token) });
  if (res.status === 404) throw new Error(`GitHub resource not found: ${path}`);
  if (res.status === 401) throw new Error('GitHub token invalid or expired');
  if (res.status === 403) throw new Error('GitHub API limit reached — provide a repo-scoped PAT');
  if (!res.ok) throw new Error(`GitHub API error ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export const MAX_GITHUB_PIECES = 300;

/**
 * Fetch snapshot pieces for a repo: README, top-level docs (docs/, *.md),
 * open+recent issues, and recent commit subjects. Deterministic order.
 */
export async function fetchGitHubSnapshot(
  repo: string, // "owner/repo"
  token?: string,
): Promise<{ title: string; pieces: IngestPiece[]; metadata: Record<string, unknown> }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo must be "owner/repo"');

  const info = await ghFetch<GhRepo>(`/repos/${repo}`, token);
  const pieces: IngestPiece[] = [];
  let idx = 0;

  const add = (label: string, location: string, text: string, url: string | null) => {
    if (!text.trim() || pieces.length >= MAX_GITHUB_PIECES) return;
    pieces.push({ idx: idx++, label, location, text: text.trim().slice(0, 8000), url });
  };

  // README (always the most valuable single document)
  const readme = await ghFetch<{ content: string; html_url: string }>(
    `/repos/${repo}/readme`,
    token,
  ).catch(() => null);
  if (readme) {
    add('README', 'file:README', decodeB64(readme.content), readme.html_url);
  }

  // Top-level + docs/ markdown files
  const rootFiles = await ghFetch<GhFile[]>(`/repos/${repo}/contents`, token).catch(() => []);
  const docsFiles = await ghFetch<GhFile[]>(`/repos/${repo}/contents/docs`, token).catch(() => []);
  const mdFiles = [...rootFiles, ...docsFiles].filter(
    (f) => f.type === 'file' && /\.(md|txt)$/i.test(f.path) && !/^readme(~|\.|$)/i.test(f.path),
  );
  for (const f of mdFiles.slice(0, 40)) {
    const b64 = await ghFetch<{ content: string }>(
      `/repos/${repo}/contents/${f.path}`,
      token,
    ).catch(() => null);
    if (b64) add(`file ${f.path}`, `file:${f.path}`, decodeB64(b64.content), f.html_url);
  }

  // Open issues with comments (limit 40) — a core source of "pending work"
  const issues = await ghFetch<GhIssue[]>(
    `/repos/${repo}/issues?state=open&per_page=40&sort=updated`,
    token,
  ).catch(() => []);
  for (const issue of issues) {
    if (issue.pull_request) continue; // skip PR entries
    add(
      `issue #${issue.number}: ${issue.title}`,
      `issue:${issue.number}`,
      [
        `State: ${issue.state}`,
        `Title: ${issue.title}`,
        issue.body ? `Body: ${issue.body}` : '',
        issue.user?.login ? `Author: @${issue.user.login}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      issue.html_url,
    );
  }

  // Recent commit subjects (limit 60) — evidence for decisions and changes
  const commits = await ghFetch<GhCommit[]>(
    `/repos/${repo}/commits?per_page=60`,
    token,
  ).catch(() => []);
  for (const c of commits) {
    const msg = c.commit.message.split('\n')[0];
    add(
      `commit ${c.sha.slice(0, 7)}: ${msg}`,
      `commit:${c.sha.slice(0, 10)}`,
      `${msg}${c.commit.author?.date ? ` — ${c.commit.author.date}` : ''}`,
      c.html_url,
    );
  }

  if (pieces.length === 0) {
    throw new Error('Repo snapshot came back empty — check the repo is readable with this token');
  }

  const metadata = {
    repo_info: { full_name: info.full_name, html_url: info.html_url, default_branch: info.default_branch, description: info.description },
    fetched_at: new Date().toISOString(),
    counts: { pieces: pieces.length },
  };
  return { title: `GitHub · ${repo}`, pieces, metadata };
}

function decodeB64(content: string): string {
  return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
}
