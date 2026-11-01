import React, { useState } from 'react';
import { supabase } from '../supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split('@')[0] } },
        });
        if (error) throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function magicLink() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMagicSent(true);
  }

  return (
    <div className="auth-wrap">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 6 }}>
          <span className="logo" style={{ fontSize: '1.3rem' }}>KnowBridge</span>
        </div>
        <p className="muted small">
          Turn scattered project activity into a traceable, permission-aware handover.
        </p>
        <div className="tabs">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
            Sign in
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Create account
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <>
              <label>Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Priya Sharma" />
            </>
          )}
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@team.example" />
          <label>Password</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {error && <div className="banner error" style={{ marginTop: 10 }}>{error}</div>}
          {magicSent && (
            <div className="banner ok" style={{ marginTop: 10 }}>
              Magic link sent — check your email.
            </div>
          )}
          <button className="btn" style={{ marginTop: 14, width: '100%' }} disabled={busy || !email || !password}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="center" style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={magicLink} disabled={!email || busy}>
            Email me a magic link instead
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 14 }}>
          Judges: create one manager account and one recipient account, then in the workspace add
          the recipient under <em>Members</em>. Demo project data is synthetic (doc §8).
        </p>
      </div>
    </div>
  );
}
