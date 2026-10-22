import { redirect } from 'next/navigation';
import { isAdmin } from '../../lib/auth.js';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  if (await isAdmin()) redirect('/dashboard');
  const sp = await searchParams;

  return (
    <main className="login-wrap">
      <form className="login-card" method="post" action="/api/login">
        <h1>Proof of Fair Weight</h1>
        <p className="muted">Admin sign in</p>
        {sp?.error ? (
          <p className="error" role="alert">
            Wrong username or password.
          </p>
        ) : null}
        <label>
          Username
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="btn primary">
          Sign in
        </button>
      </form>
    </main>
  );
}
