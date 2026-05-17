import { NavLink, Outlet } from 'react-router-dom'
import { useLogout } from '../api/hooks.js'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/installs', label: 'Installs' },
  { to: '/downloads', label: 'Downloads' },
  { to: '/version-health', label: 'Version Health' },
  { to: '/usage', label: 'Usage Activity' },
  { to: '/errors', label: 'Errors' },
  { to: '/releases', label: 'Releases & Policy' },
  { to: '/events', label: 'Event Explorer' },
  { to: '/privacy', label: 'Privacy & Data' }
]

export default function Layout({ user }) {
  const logout = useLogout()
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Cue
          <small>admin dashboard</small>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">Signed in as {user}</div>
          <button onClick={() => logout.mutate()} style={{ width: '100%' }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
