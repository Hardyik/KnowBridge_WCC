import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { get, post } from '../api';
import { supabase } from '../supabase';

interface ProjectWithRole {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  my_role: 'manager' | 'reviewer' | 'recipient';
  created_at: string;
}

export default function ProjectsScreen({ user }: { user: User | null }) {
  const nav = useNavigate();
  const [projects, setProjects] = useState<ProjectWithRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setBusy(true);
    try {
      const { projects: list } = await get<{ projects: ProjectWithRole[] }>('/projects');
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { project } = await post<{ project: { id: string } }>('/projects', { name, description });
      setCreating(false);
      nav(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <Header user={user} />
      <div className="container">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Projects</h2>
          <button className="btn" onClick={() => setCreating(!creating)}>
            {creating ? 'Cancel' : '+ New project'}
          </button>
        </div>
        {error && <div className="banner error">{error}</div>}
        {creating && (
          <form className="panel" onSubmit={createProject}>
            <h3>Create a project</h3>
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Payments Platform — Gateway Migration"
              required
            />
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the project does and why a handover is needed"
            />
            <button className="btn" style={{ marginTop: 12 }}>Create</button>
          </form>
        )}
        {busy ? (
          <p className="muted">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="panel muted">
            No projects yet. Create one, upload a few documents, connect a GitHub repo, then run
            extraction to build a reviewable handover.
          </div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="card" style={{ color: 'inherit' }}>
                <div className="title">{p.name}</div>
                <div className="muted small">{p.description || 'No description'}</div>
                <div style={{ marginTop: 8 }}>
                  <span className="badge cat">{p.my_role}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function Header({ user }: { user: User | null }) {
  return (
    <div className="header">
      <div className="brand">
        <Link to="/" className="logo">
          KnowBridge
        </Link>
        <span className="tag">knowledge handover · Fallen Crows</span>
      </div>
      <div className="row" style={{ flex: 'none', gap: 8 }}>
        <span className="muted small">{user?.email}</span>
        <button className="btn secondary small" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
