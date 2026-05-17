import { useMe } from '../api/hooks.js'
import Login from './Login.jsx'

// Route guard — renders children only when /admin/me succeeds.
// (App.jsx performs the same check at the top level; this is here for any
// nested guarding needs.)
export default function RequireAuth({ children }) {
  const me = useMe()
  if (me.isLoading) return <div className="loading" style={{ padding: 48 }}>Loading…</div>
  if (me.isError || !me.data) return <Login />
  return children
}
