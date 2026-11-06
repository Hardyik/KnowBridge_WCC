import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import SignInScreen from './screens/SignInScreen';
import ProjectsScreen from './screens/ProjectsScreen';
import WorkspaceScreen from './screens/WorkspaceScreen';
import RecipientViewScreen from './screens/RecipientViewScreen';
import DeliveryScreen from './screens/DeliveryScreen';

function useRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') ?? '');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const { profile, loading, signOut } = useAuth();
  const route = useRoute();

  // A delivery link is deliberately readable without an account: the token is
  // the authorisation, and the API enforces its scope and expiry.
  const deliveryMatch = route.match(/^\/delivery\/([A-Za-z0-9_-]{10,})/);
  if (deliveryMatch) return <DeliveryScreen token={deliveryMatch[1]} />;

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" /> Loading KnowBridge…
      </div>
    );
  }

  if (!profile) return <SignInScreen />;

  const projectMatch = route.match(/^\/project\/([0-9a-f-]{36})/i);
  const handoverMatch = route.match(/^\/handover\/([0-9a-f-]{36})/i);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          KnowBridge<span>knowledge handover</span>
        </a>
        <div className="topbar-right">
          <span className="muted small">{profile.display_name}</span>
          <button className="ghost small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        {handoverMatch ? (
          <RecipientViewScreen handoverId={handoverMatch[1]} />
        ) : projectMatch ? (
          <WorkspaceScreen projectId={projectMatch[1]} />
        ) : (
          <ProjectsScreen />
        )}
      </main>
    </div>
  );
}
