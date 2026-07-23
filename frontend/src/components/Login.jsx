import { useState } from 'react';
import { api } from '../api/client';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('Admin@12345');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(email.trim(), password);
      onSignedIn(session.user);
    } catch (err) {
      setError(
        err.status === 401
          ? 'That email and password combination is not recognised.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark" />
          <span className="brand-name">Segment Console</span>
        </div>
        <p className="login-sub">Sign in with a staff account to see the audience.</p>

        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {error && <div className="banner banner-error" role="alert">{error}</div>}

        <button className="send-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-hint">
          Seeded accounts: <code>admin@example.com / Admin@12345</code> ·{' '}
          <code>manager@example.com / Manager@12345</code>
        </p>
      </form>
    </div>
  );
}
