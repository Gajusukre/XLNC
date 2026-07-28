import { useState, FormEvent } from 'react';
import { useRouter } from 'next/router';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Login failed');
        setSubmitting(false);
        return;
      }
      const redirectTo = typeof router.query.from === 'string' ? router.query.from : '/';
      router.push(redirectTo);
    } catch {
      setError('Could not reach the login service');
      setSubmitting(false);
    }
  }

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 360, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>XLNC Platform</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="email" style={{ display: 'block', marginBottom: '0.25rem' }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password" style={{ display: 'block', marginBottom: '0.25rem' }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={submitting} style={{ padding: '0.5rem 1rem' }}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
