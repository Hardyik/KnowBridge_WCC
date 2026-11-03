/**
 * Demo seed: two accounts, one project, both members.
 * Re-running is safe — existing users, project and membership are reused.
 *
 *   npm run seed
 */
import { config } from '../src/config.js';
import { serviceClient, Tables } from '../src/db.js';

const PASSWORD = 'KnowBridge2026!';

const PEOPLE = [
  { email: 'manager@knowbridge.demo', display_name: 'Dana Okafor', role: 'manager', scope: 'manager' },
  { email: 'incoming@knowbridge.demo', display_name: 'Alex Mensah', role: 'recipient', scope: 'engineer' },
] as const;

const PROJECT = {
  name: 'Ledgerline payments migration',
  description:
    'Replacing the legacy transaction processor with Node services: card payments are live on the new pathway, bank transfer settlement is still legacy.',
};

async function ensureUser(email: string, displayName: string): Promise<string> {
  const db = serviceClient();
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await db.from(Tables.profiles).upsert({ id: existing.id, email, display_name: displayName });
    return existing.id;
  }

  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
  await db.from(Tables.profiles).upsert({ id: data.user.id, email, display_name: displayName });
  return data.user.id;
}

async function main() {
  const db = serviceClient();
  console.log(`Seeding ${config.supabaseUrl}`);

  const ids = new Map<string, string>();
  for (const person of PEOPLE) {
    ids.set(person.email, await ensureUser(person.email, person.display_name));
  }

  const { data: existingProject } = await db
    .from(Tables.projects)
    .select('*')
    .eq('name', PROJECT.name)
    .maybeSingle();

  const managerId = ids.get(PEOPLE[0].email)!;
  let projectId = existingProject?.id as string | undefined;

  if (!projectId) {
    const { data: project, error } = await db
      .from(Tables.projects)
      .insert({ ...PROJECT, owner_id: managerId })
      .select('*')
      .single();
    if (error || !project) throw new Error(`Could not create project: ${error?.message}`);
    projectId = project.id as string;
  }

  for (const person of PEOPLE) {
    const userId = ids.get(person.email)!;
    const { data: member } = await db
      .from(Tables.projectMembers)
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (member) continue;
    const { error } = await db.from(Tables.projectMembers).insert({
      project_id: projectId,
      user_id: userId,
      role: person.role,
      scope: person.scope,
    });
    if (error) throw new Error(`Could not add ${person.email}: ${error.message}`);
  }

  console.log(`Project: ${PROJECT.name} (${projectId})`);
  console.log('Accounts:');
  for (const person of PEOPLE) console.log(`  ${person.email} / ${PASSWORD}  (${person.role})`);
  console.log('\nNext: sign in as the manager, upload demo-data/documents/*, then run extraction.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
