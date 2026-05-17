import { Routes, Route } from 'react-router-dom'
import { useMe } from './api/hooks.js'
import Login from './auth/Login.jsx'
import Layout from './components/Layout.jsx'
import Overview from './pages/Overview.jsx'
import Installs from './pages/Installs.jsx'
import Downloads from './pages/Downloads.jsx'
import VersionHealth from './pages/VersionHealth.jsx'
import UsageActivity from './pages/UsageActivity.jsx'
import SessionDetail from './pages/SessionDetail.jsx'
import Errors from './pages/Errors.jsx'
import Releases from './pages/Releases.jsx'
import EventExplorer from './pages/EventExplorer.jsx'
import Privacy from './pages/Privacy.jsx'

export default function App() {
  const me = useMe()

  if (me.isLoading) {
    return <div className="loading" style={{ padding: 48 }}>Loading…</div>
  }
  if (me.isError || !me.data) {
    return <Login />
  }

  return (
    <Routes>
      <Route element={<Layout user={me.data.user} />}>
        <Route index element={<Overview />} />
        <Route path="installs" element={<Installs />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="version-health" element={<VersionHealth />} />
        <Route path="usage" element={<UsageActivity />} />
        <Route path="sessions/:id" element={<SessionDetail />} />
        <Route path="errors" element={<Errors />} />
        <Route path="releases" element={<Releases />} />
        <Route path="events" element={<EventExplorer />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="*" element={<Overview />} />
      </Route>
    </Routes>
  )
}
