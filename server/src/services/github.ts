/**
 * Read-only GitHub connector.
 *
 * A repository is turned into the same shape as an uploaded document: text
 * passages with a heading, so every claim from GitHub can quote its passage
 * and point at a real issue, commit or README section. Nothing is written
 * back to GitHub.
 */

import { HttpError } from '../auth.js';
import { config } from '../config.js';
import { chunkDocument } from './documents.js';

const API = 'https://api.github.com';
const README_LIMIT = 60_000;
const ISSUES_LIMIT = 40_000;
const COMMITS_LIMIT = 20_000;

export interface GithubChunk {
  heading: string;
  text: string;
  occurred_at: string | null;
}

export interface GithubSource {
  title: string;
  filename: string;
  chunks: GithubChunk[];
}

export interface GithubFetchResult {
  external_ref: string;
  repo: string;
  description: string;
  sources: GithubSource[];
  notes: string[];
}

/** Accept `owner/repo`, a github.com URL, or a URL with a trailing .git. */
export function parseRepoRef(input: string): { owner: string; repo: string; full: string } {
  const cleaned = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new HttpError(400, 'Use a repository as owner/name, for example Hardyik/KnowBridge_WCC');
  }
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new HttpError(400, 'That does not look like a GitHub repository');
  }
  return { owner, repo, full: `${owner}/${repo}` };
}

function headers(accept: string): Record<string, string> {
  const base: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'KnowBridge',
  };
  if (config.githubToken) base.Authorization = `Bearer ${config.githubToken}`;
  return base;
}

async function get(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: headers(accept),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new HttpError(502, `GitHub did not respond: ${(err as Error).message}`);
  }

  if (response.ok) return response;
  if (response.status === 404) {
    throw new HttpError(404, 'That repository is not public, or it does not exist');
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset) {
      const minutes = Math.max(1, Math.round((Number(reset) * 1000 - Date.now()) / 60_000));
      throw new HttpError(
        429,
        `GitHub's anonymous rate limit is used up; try again in about ${minutes} minute(s) or set GITHUB_TOKEN on the API`,
      );
    }
    throw new HttpError(403, 'GitHub refused the request — a private repository needs GITHUB_TOKEN on the API');
  }
  throw new HttpError(502, `GitHub returned ${response.status}`);
}

/**
 * One passage per issue or commit: the heading is the citation anchor and the
 * item's own date goes with it, so the timeline can order it. Long bodies are
 * split at paragraph boundaries rather than dropped.
 */
function perItem(
  sections: { heading: string; body: string; occurred_at: string | null }[],
): GithubChunk[] {
  const chunks: GithubChunk[] = [];
  for (const section of sections) {
    const heading = section.heading.slice(0, 110);
    const body = section.body.trim();
    if (!body) continue;

    if (body.length <= 1500) {
      chunks.push({ heading, text: `${heading}\n${body}`, occurred_at: section.occurred_at });
      continue;
    }

    let part = 1;
    let buffer = '';
    const flush = () => {
      if (buffer.trim()) {
        chunks.push({
          heading: `${heading} (part ${part})`,
          text: `${heading} (part ${part})\n${buffer.trim()}`,
          occurred_at: section.occurred_at,
        });
        part += 1;
        buffer = '';
      }
    };
    for (const paragraph of body.split(/\n\n+/)) {
      if ((buffer + paragraph).length > 1400) flush();
      buffer += `${paragraph}\n\n`;
    }
    flush();
  }
  return chunks;
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function day(value: string | null): string {
  if (!value) return 'undated';
  return value.slice(0, 10);
}

interface IssueRow {
  number: number;
  title: string;
  state: string;
  body: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface CommitRow {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

export async function fetchGithubSources(input: string): Promise<GithubFetchResult> {
  const { full } = parseRepoRef(input);
  const notes: string[] = [];

  const repoResponse = await get(`/repos/${full}`);
  const repo = (await repoResponse.json()) as {
    full_name: string;
    description: string | null;
    private: boolean;
    html_url: string;
  };
  if (repo.private) {
    throw new HttpError(
      403,
      'That repository is private. The connector reads public repositories only; a private repo needs an access token the manager supplies.',
    );
  }

  const sources: GithubSource[] = [];

  // README ------------------------------------------------------------------
  try {
    const readmeResponse = await get(`/repos/${full}/readme`, 'application/vnd.github.raw');
    const readme = (await readmeResponse.text()).slice(0, README_LIMIT);
    const chunks = chunkDocument(readme).map((chunk) => ({
      heading: chunk.heading,
      text: chunk.text,
      occurred_at: null,
    }));
    if (chunks.length) {
      sources.push({ title: `${full} — README`, filename: 'README', chunks });
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw err;
    notes.push(`README not read: ${(err as Error).message}`);
  }

  // Issues and pull requests ------------------------------------------------
  try {
    const issuesResponse = await get(`/repos/${full}/issues?state=all&per_page=15&sort=updated&direction=desc`);
    const rows = (await issuesResponse.json()) as IssueRow[];
    const issues = rows.filter((row) => !row.pull_request);
    let budget = ISSUES_LIMIT;

    const sections = issues
      .map((issue) => {
        const occurred = iso(issue.updated_at ?? issue.created_at);
        const labels = issue.labels.map((label) => label.name).join(', ') || 'none';
        const body = (issue.body ?? '').replace(/\r\n?/g, '\n').trim() || '(no description)';
        return {
          heading: `Issue #${issue.number} — ${issue.title} (${issue.state}, ${day(occurred)})`,
          body: [
            `Opened by ${issue.user?.login ?? 'unknown'} on ${day(iso(issue.created_at))}, updated ${day(occurred)}.`,
            `State: ${issue.state}. Labels: ${labels}.`,
            '',
            body.slice(0, 4000),
          ].join('\n'),
          occurred_at: occurred,
        };
      })
      .filter((section) => {
        budget -= section.body.length;
        return budget > 0;
      });

    const chunks = perItem(sections);
    if (chunks.length) {
      sources.push({ title: `${full} — issues`, filename: 'issues', chunks });
    }
    notes.push(`${issues.length} issue(s) read`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw err;
    notes.push(`Issues not read: ${(err as Error).message}`);
  }

  // Recent commits ----------------------------------------------------------
  try {
    const commitsResponse = await get(`/repos/${full}/commits?per_page=15`);
    // Merge commits repeat what their branch commits already say.
    const rows = ((await commitsResponse.json()) as CommitRow[]).filter(
      (row) => !/^Merge (pull request|branch)/i.test(row.commit.message),
    );
    let budget = COMMITS_LIMIT;

    const sections = rows
      .map((row) => {
        const occurred = iso(row.commit.author?.date ?? null);
        const message = row.commit.message.replace(/\r\n?/g, '\n').trim();
        const [firstLine, ...rest] = message.split('\n');
        return {
          heading: `Commit ${row.sha.slice(0, 7)} — ${firstLine.slice(0, 80)} (${day(occurred)})`,
          body: [
            `Author: ${row.commit.author?.name ?? 'unknown'}, committed ${day(occurred)}.`,
            rest.join('\n').trim(),
          ]
            .filter(Boolean)
            .join('\n'),
          occurred_at: occurred,
        };
      })
      .filter((section) => {
        budget -= section.body.length;
        return budget > 0;
      });

    const chunks = perItem(sections);
    if (chunks.length) {
      sources.push({ title: `${full} — recent commits`, filename: 'commits', chunks });
    }
    notes.push(`${rows.length} commit(s) read`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw err;
    notes.push(`Commits not read: ${(err as Error).message}`);
  }

  if (!sources.length) {
    throw new HttpError(422, 'Nothing readable in that repository — it has no README, issues or commits');
  }

  return {
    external_ref: repo.full_name ?? full,
    repo: repo.html_url,
    description: repo.description ?? '',
    sources,
    notes,
  };
}
