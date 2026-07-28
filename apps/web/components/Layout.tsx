import { ReactNode } from 'react';

interface Viewer {
  email?: string;
  role?: string;
}

export function Layout({ title, viewer, children }: { title: string; viewer: Viewer | null; children: ReactNode }) {
  async function handleLogout() {
    await fetch('/api/session/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>
          <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            XLNC Platform
          </a>
        </h1>
        {viewer && (
          <div style={{ fontSize: '0.9rem', color: '#666' }}>
            {viewer.email} ({viewer.role}){' '}
            <button onClick={handleLogout} style={{ marginLeft: '0.5rem' }}>
              Log out
            </button>
          </div>
        )}
      </div>
      <h2 style={{ color: '#333', fontWeight: 500 }}>{title}</h2>
      {children}
    </main>
  );
}
