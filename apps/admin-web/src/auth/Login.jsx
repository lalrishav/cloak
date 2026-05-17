import { useState } from 'react'
import { useLogin } from '../api/hooks.js'

export default function Login() {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const login = useLogin()

  const submit = (e) => {
    e.preventDefault()
    login.mutate({ user, pass })
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>Cue Admin</h1>
        <p>Sign in to manage releases, version policy, and telemetry.</p>
        {login.isError && (
          <div className="error-banner">Invalid username or password.</div>
        )}
        <div className="field">
          <label>Username</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        <button
          className="primary"
          type="submit"
          disabled={login.isPending}
          style={{ width: '100%', marginTop: 8 }}
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
