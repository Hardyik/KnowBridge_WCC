import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ProjectSummary } from '@knowbridge/shared';
import { api, ApiError, navigate } from '../api';

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ projects: ProjectSummary[] }>('/projects');
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const data = await api<{ project: { id: string } }>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      setName('');
      setDescription('');
      navigate(`/project/${data.project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted small">Each project holds its own sources, claims and handover versions.</p>
        </div>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <section className="card pad-lg stack">
          <h3>Start a handover project</h3>
          <p className="muted small">
            Name it after the project being handed over. You become its manager and can invite the
            departing engineer and the incoming person.
          </p>
          <form className="stack" onSubmit={create}>
            <div>
              <label htmlFor="project-name">Project name</label>
              <input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ledgerline payments migration"
                required
                minLength={2}
              />
            </div>
            <div>
              <label htmlFor="project-description">What is being handed over?</label>
              <textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description for reviewers and the incoming person."
              />
            </div>
            <button className="primary" type="submit" disabled={creating || !name.trim()}>
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        </section>

        <section className="stack">
          {projects === null && (
            <div className="empty">
              <span className="spinner" />
              Loading projects…
            </div>
          )}
          {projects?.length === 0 && (
            <div className="empty">
              <strong>No projects yet</strong>
              <p className="small">
                Create one on the left. Once created, a manager can upload documents and run
                extraction.
              </p>
            </div>
          )}
          {projects?.map((project) => (
            <a className="card project-card" key={project.id} href={`#/project/${project.id}`}>
              <div className="spread">
                <h3>{project.name}</h3>
                <span className="badge cat">{project.role}</span>
              </div>
              {project.description && <p className="muted small">{project.description}</p>}
              <div className="row" style={{ gap: 18 }}>
                <span className="muted tiny">{project.source_count} sources</span>
                <span className="muted tiny">{project.claim_count} claims</span>
                {project.approved_handover ? (
                  <span className="badge supported">v{project.approved_handover.version} approved</span>
                ) : (
                  <span className="badge pending">no approved handover</span>
                )}
              </div>
            </a>
          ))}
        </section>
      </div>
    </>
  );
}
