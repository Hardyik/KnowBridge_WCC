import { FormEvent, useState } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('manager@knowbridge.demo');
  const [password, setPassword] = useState('KnowBridge2026!');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(email.trim(), password);
      else await signUp(email.trim(), password, displayName.trim() || email.split('@')[0]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout-auth">
      <section className="auth-hero">
        <span className="badge cat">Round 3 build · Fallen Crows</span>
        <h1>Hand over the work, not the guesswork.</h1>
        <p className="muted">
          KnowBridge turns project documents into a reviewable handover where every statement
          carries its evidence, gaps are flagged instead of invented, and the incoming person
          sees only what their role allows.
        </p>
        <ul>
          <li>Upload the documents a departing engineer left behind.</li>
          <li>Extract decisions, work, owners, risks and next actions.</li>
          <li>Verify, correct, redact and approve before sharing.</li>
          <li>Deliver a role-scoped handover and record the acknowledgement.</li>
        </ul>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <h2>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h2>
            <p className="muted small">
              {mode === 'signin'
                ? 'Demo accounts are seeded with npm run seed.'
                : 'New accounts start with no projects until a manager invites them.'}
            </p>
          </div>

          {mode === 'signup' && (
            <div>
              <label htmlFor="name">Display name</label>
              <input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Mensah"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="notice bad">{error}</div>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <button
            type="button"
            className="ghost small"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
            }}
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already registered? Sign in'}
          </button>

          <div className="divider" />
          <p className="muted tiny">
            Demo credentials: manager@knowbridge.demo · incoming@knowbridge.demo — password
            KnowBridge2026!
          </p>
        </form>
      </section>
    </div>
  );
}
