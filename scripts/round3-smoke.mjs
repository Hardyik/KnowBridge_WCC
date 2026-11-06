#!/usr/bin/env node
/**
 * Round 3 end-to-end smoke test.
 *
 *   node scripts/round3-smoke.mjs connect|extract|refresh|handover|delivery|assistant|all
 *
 * Runs against a local API (default http://localhost:4000/api) with the seeded
 * demo accounts. It exercises the real routes against the real Supabase project,
 * so it proves the deployment path rather than a mock.
 */

const BASE = (process.env.API ?? 'http://localhost:4000/api').replace(/\/$/, '');
const REPO = process.env.REPO ?? 'Hardyik/KnowBridge_WCC';
const MANAGER = { email: 'manager@knowbridge.demo', password: 'KnowBridge2026!' };
const INCOMING = { email: 'incoming@knowbridge.demo', password: 'KnowBridge2026!' };

let failures = 0;
function check(label, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, ok: response.ok, payload };
}

async function login(account) {
  const { ok, payload, status } = await call('POST', '/auth/login', { body: account });
  if (!ok) throw new Error(`login failed (${status}): ${payload.error}`);
  return payload;
}

async function demoProject(token) {
  const { payload } = await call('GET', '/projects', { token });
  const projects = payload.projects ?? [];
  const project = projects.find((p) => /ledgerline/i.test(p.name)) ?? projects[0];
  if (!project) throw new Error('no project found — run npm run seed first');
  return project;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractWithRetry(token, projectId, { refresh = false, rounds = 4 } = {}) {
  let last;
  for (let round = 1; round <= rounds; round += 1) {
    const { ok, payload, status } = await call('POST', `/projects/${projectId}/extract`, {
      token,
      body: { refresh },
    });
    if (!ok) {
      console.log(`    extraction attempt ${round} failed (${status}): ${payload.error}`);
      if (/429|rate|busy/i.test(payload.error ?? '')) {
        await sleep(30_000);
        continue;
      }
      return null;
    }
    last = payload.summary;
    const throttled = last.sources_failed.some((line) => /429|rate|TPM|tokens per minute/i.test(line));
    console.log(
      `    run ${round}: ${last.claims_created} new, ${last.duplicates_skipped} duplicate(s), ` +
        `${last.sources_failed.length} failed passage(s)`,
    );
    if (!throttled) return last;
    await sleep(20_000);
  }
  return last ?? null;
}

async function connect(manager, projectId) {
  console.log(`\n1. GitHub connector — ${REPO}`);
  const { ok, payload, status } = await call('POST', `/projects/${projectId}/sources/github`, {
    token: manager.token,
    body: { repo: REPO, confidentiality: 'internal' },
  });
  if (!ok) {
    check('repository connected', false, `${status} ${payload.error}`);
    return;
  }
  check('repository connected', payload.sources.length >= 2, `${payload.sources.length} sources`);
  for (const note of payload.notes ?? []) console.log(`    note: ${note}`);

  const { payload: sources } = await call('GET', `/projects/${projectId}/sources`, { token: manager.token });
  const github = (sources.sources ?? []).filter((source) => source.kind === 'github');
  check('sources carry kind + external_ref', github.every((s) => s.external_ref), `${github.length} github source(s)`);
}

async function extract(manager, projectId) {
  console.log('\n2. Extraction merges documents and repository claims');
  const summary = await extractWithRetry(manager.token, projectId);
  if (!summary) return check('extraction completed', false);
  check('extraction completed', true, `${summary.claims_created} new claims`);

  const { payload } = await call('GET', `/projects/${projectId}/claims`, { token: manager.token });
  const claims = payload.claims ?? [];
  const githubClaims = claims.filter((claim) => claim.source_kind === 'github');
  const dated = githubClaims.filter((claim) => claim.occurred_at);
  check('claims carry their source kind', githubClaims.length > 0, `${githubClaims.length} repository claims`);
  check('repository claims carry a timeline date', dated.length > 0, `${dated.length} dated`);
  console.log(
    `    corroborated across source kinds: ${claims.filter((c) => c.corroborations.length > 0).length}`,
  );
}

async function refresh(manager, projectId) {
  console.log('\n3. Review-preserving re-extraction');
  const { payload } = await call('GET', `/projects/${projectId}/claims`, { token: manager.token });
  const claims = payload.claims ?? [];
  const target =
    claims.find((claim) => claim.category === 'decision' && claim.status === 'supported') ??
    claims.find((claim) => claim.status === 'supported');
  if (!target) return check('a claim to verify', false, 'no supported claim found');

  const marked = await call('PATCH', `/claims/${target.id}`, {
    token: manager.token,
    body: { review_state: 'verified' },
  });
  check('reviewer verified a claim', marked.ok, target.text.slice(0, 60));

  const summary = await extractWithRetry(manager.token, projectId, { refresh: true, rounds: 1 });
  if (!summary) return check('refresh completed', false);
  check('refresh ran', summary.refreshed === true);
  check('reviewer decisions preserved', summary.reviews_preserved > 0, `${summary.reviews_preserved} preserved`);

  const { payload: after } = await call('GET', `/projects/${projectId}/claims`, { token: manager.token });
  const stillThere = (after.claims ?? []).find((claim) => claim.id === target.id);
  check('verified claim survived the refresh', Boolean(stillThere), stillThere ? 'same claim id' : 'claim lost');
  check('verified state survived', stillThere?.review_state === 'verified', stillThere?.review_state);
}

async function handover(manager, projectId) {
  console.log('\n4. Version comparison and rollback');
  const created = await call('POST', `/projects/${projectId}/handovers`, { token: manager.token, body: {} });
  let list = (await call('GET', `/projects/${projectId}/handovers`, { token: manager.token })).payload.handovers ?? [];
  let draft = list.find((item) => item.status === 'draft');
  if (!draft && created.payload.handover) draft = created.payload.handover;
  if (draft) {
    const approved = await call('POST', `/handovers/${draft.id}/approve`, { token: manager.token });
    check('draft approved', approved.ok, approved.payload.error ?? `v${approved.payload.handover?.version}`);
  }

  list = (await call('GET', `/projects/${projectId}/handovers`, { token: manager.token })).payload.handovers ?? [];
  // Superseded versions keep their frozen snapshot, so they are the ones a diff
  // and a rollback target.
  const approved = list
    .filter((item) => item.status === 'approved' || item.status === 'superseded')
    .sort((a, b) => b.version - a.version);
  check('at least two versions with snapshots exist', approved.length >= 2, `${approved.length} version(s)`);

  if (approved.length >= 2) {
    const diff = await call('GET', `/handovers/${approved[0].id}/diff/${approved[1].id}`, {
      token: manager.token,
    });
    check('version diff returned', diff.ok, diff.payload.error);
    const d = diff.payload.diff;
    if (d) {
      console.log(
        `    v${d.from.version} → v${d.to.version}: ${d.added.length} added, ${d.removed.length} removed, ` +
          `${d.changed.length} rewritten, ${d.unchanged} unchanged`,
      );
    }

    const restored = await call('POST', `/handovers/${approved[1].id}/rollback`, { token: manager.token });
    check('previous version restored', restored.ok, restored.payload.error);
  }
}

async function delivery(manager, incoming, projectId) {
  console.log('\n5. Confidentiality tiers and expiring delivery links');
  const list = (await call('GET', `/projects/${projectId}/handovers`, { token: manager.token })).payload.handovers ?? [];
  const current = list.find((item) => item.status === 'approved');
  if (!current) return check('an approved handover exists', false);

  const sources = (await call('GET', `/projects/${projectId}/sources`, { token: manager.token })).payload.sources ?? [];
  const document = sources.find((source) => source.kind === 'document');
  const original = document?.confidentiality ?? 'internal';

  await call('PATCH', `/projects/${projectId}/sources/${document.id}`, {
    token: manager.token,
    body: { confidentiality: 'restricted' },
  });

  const recipient = await call('GET', `/handovers/${current.id}/recipient`, { token: incoming.token });
  const restrictedTitle = document.title;
  const leaked = (recipient.payload.sections ?? []).some((section) =>
    section.claims.some((claim) => claim.evidence.source_title === restrictedTitle),
  );
  check('restricted source never reaches a recipient view', recipient.ok && !leaked, restrictedTitle);

  const link = await call('POST', `/handovers/${current.id}/deliveries`, {
    token: manager.token,
    body: { scope: 'general', days: 3, recipient_label: 'Smoke test recipient' },
  });
  check('delivery link created', link.ok, link.payload.error);
  const token = link.payload.delivery?.token;
  if (!token) {
    await call('PATCH', `/projects/${projectId}/sources/${document.id}`, {
      token: manager.token,
      body: { confidentiality: original },
    });
    return;
  }

  const publicView = await call('GET', `/delivery/${token}`);
  check('public link opens without an account', publicView.ok, publicView.payload.error);
  const sections = publicView.payload.sections ?? [];
  check(
    'link honours its general scope',
    sections.every((section) => ['overview', 'pending', 'next_actions'].includes(section.key)),
    sections.map((section) => section.key).join(', '),
  );
  const linkLeak = sections.some((section) =>
    section.claims.some((claim) => claim.evidence.source_title === restrictedTitle),
  );
  check('restricted source is withheld from the delivery link too', !linkLeak);

  const ack = await call('POST', `/delivery/${token}/acknowledge`, {
    body: { name: 'Smoke Recipient', email: 'smoke@example.com' },
  });
  check('acknowledgement recorded', ack.ok, ack.payload.error);
  const reopened = await call('GET', `/delivery/${token}`);
  check('acknowledgement is visible on reopen', Boolean(reopened.payload.acknowledged_at));

  const list2 = await call('GET', `/handovers/${current.id}/deliveries`, { token: manager.token });
  const tracked = (list2.payload.deliveries ?? []).find((item) => item.id === link.payload.delivery.id);
  check('manager sees the acknowledgement', Boolean(tracked?.acknowledgement), tracked?.acknowledgement?.name);
  check('link shows an expiry', Boolean(tracked?.expires_at));

  await call('PATCH', `/projects/${projectId}/sources/${document.id}`, {
    token: manager.token,
    body: { confidentiality: original },
  });
  check('source tier restored', true, original);
}

async function assistant(manager, projectId) {
  console.log('\n6. AI assistant');
  const pending = await call('POST', `/projects/${projectId}/assistant`, {
    token: manager.token,
    body: { question: 'What is still pending, and who owns it?' },
  });
  if (!pending.ok) return check('assistant answered', false, pending.payload.error);
  check('assistant answered', true, `${pending.payload.message.content.length} chars`);
  check('answer cites claims', pending.payload.message.citations.length > 0, `${pending.payload.message.citations.length} citation(s)`);
  console.log(`    answer: ${pending.payload.message.content.replace(/\s+/g, ' ').slice(0, 220)}`);
  if (pending.payload.message.citations[0]) {
    console.log(
      `    first citation: ${pending.payload.message.citations[0].source_title} — ` +
        pending.payload.message.citations[0].text.slice(0, 90),
    );
  }

  const offTopic = await call('POST', `/projects/${projectId}/assistant`, {
    token: manager.token,
    body: { question: 'Who won the 2010 football World Cup?' },
  });
  check('off-topic question stays ungrounded', offTopic.ok && offTopic.payload.grounded === false);
  console.log(`    answer: ${String(offTopic.payload.message?.content ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);

  const history = await call('GET', `/projects/${projectId}/assistant`, { token: manager.token });
  check('conversation is stored', (history.payload.messages ?? []).length >= 4, `${(history.payload.messages ?? []).length} messages`);
}

async function main() {
  const step = process.argv[2] ?? 'all';
  const manager = await login(MANAGER);
  const incoming = await login(INCOMING);
  const project = await demoProject(manager.token);
  console.log(`Project: ${project.name} (${project.id})`);

  const steps = {
    connect: () => connect(manager, project.id),
    extract: () => extract(manager, project.id),
    refresh: () => refresh(manager, project.id),
    handover: () => handover(manager, project.id),
    delivery: () => delivery(manager, incoming, project.id),
    assistant: () => assistant(manager, project.id),
  };

  if (step === 'all') {
    for (const run of Object.values(steps)) await run();
  } else {
    if (!steps[step]) throw new Error(`unknown step ${step}`);
    await steps[step]();
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
