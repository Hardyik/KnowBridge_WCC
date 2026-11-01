import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { supabaseConfigured } from './supabase';
import AuthScreen from './screens/AuthScreen';
import ProjectsScreen from './screens/ProjectsScreen';
import ProjectWorkspace from './screens/ProjectWorkspace';
import HandoverEditor from './screens/HandoverEditor';
import RecipientViewScreen from './screens/RecipientViewScreen';

function Shell() {
  const { session, user, loading } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div className="container auth-wrap">
        <div className="panel">
          <h2>KnowBridge — setup required</h2>
          <p className="muted small">
            The web client is not connected to Supabase yet. Copy{' '}
            <code>web/.env.example</code> to <code>web/.env</code> and fill in{' '}
            <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart{' '}
            <code>npm run dev</code>.
          </p>
          <p className="muted small">
            Server setup lives in <code>server/.env</code> (see <code>server/.env.example</code>)
            and the community schema is <code>docs/supabase_schema.sql</code>.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container center muted" style={{ marginTop: '20vh' }}>
        Loading session…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={!session ? <AuthScreen /> : <Navigate to="/" replace />} />
      <Route
        path="/"
        element={session ? <ProjectsScreen user={user} /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/projects/:projectId"
        element={session ? <ProjectWorkspace /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/handovers/:handoverId/review"
        element={session ? <HandoverEditor /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/handovers/:handoverId/recipient"
        element={session ? <RecipientViewScreen /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/handovers/:handoverId/view"
        element={
          session ? (
            <Navigate to="recipient" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
