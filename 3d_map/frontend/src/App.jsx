import React, { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SESSION_KEY } from './constants.js'
import Landing from './components/Landing.jsx'
import Login from './components/Login.jsx'
const Dashboard = lazy(() => import('./components/Dashboard.jsx'))
const Building3DView = lazy(() => import('./pages/Building3DView.jsx'))
import Topbar from './components/layout/Topbar.jsx'
import PropertyDetails from './pages/PropertyDetails.jsx'
import ComplaintForm from './pages/ComplaintForm.jsx'
import PropertyRecords from './pages/PropertyRecords.jsx'
import UnifiedPropertyCard from './pages/UnifiedPropertyCard.jsx'
import UnitUpc from './pages/UnitUpc.jsx'
import Verify from './pages/Verify.jsx'
import Profile from './pages/Profile.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Heavy libs (maplibre ~800 KB, three + drei ~1 MB) load only on the
// pages / views that actually need them.
const UlpinView        = lazy(() => import('./components/UlpinView.jsx'))
const LidarMap         = lazy(() => import('./components/LidarMap.jsx'))
const PointCloudViewer = lazy(() => import('./components/PointCloudViewer.jsx'))
const ObliqueImagery   = lazy(() => import('./components/ObliqueImagery.jsx'))

const PageFallback = () => <div className="loading muted">loading…</div>

// ── session helpers ───────────────────────────────────────────────────────────

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null } catch { return null }
}
function saveSession(s) {
  if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else   sessionStorage.removeItem(SESSION_KEY)
}

// ── page wrapper (shared chrome for portal pages) ─────────────────────────────

/**
 * Wraps a page component with the app topbar and a centred content column.
 * `maxW` controls the max-width of the content area.
 */
function PageShell({ session, onLogout, activeLanguage, onLanguageChange, maxW = '1100px', children }) {
  return (
    <div className="app min-h-screen citizen-dash" style={{ background: '#F5F6F8', color: '#1C2530', overflowY: 'auto' }}>
      <Topbar
        session={session}
        onLogout={onLogout}
        activeLanguage={activeLanguage}
        onLanguageChange={onLanguageChange}
      />
      <div className="citizen-shell-body flex min-w-0 flex-1">
        <main className="flex-1 min-w-0 p-5 w-full mx-auto" style={{ maxWidth: maxW }}>
          {children}
        </main>
      </div>
    </div>
  )
}

// Each portal is its own world: signed-out visitors go to the landing page, and a
// role that opens another role's URL is sent back to its own dashboard.
const STAFF = ['surveyor', 'registrar']
function Only({ session, roles, children }) {
  if (!session) return <Navigate to="/" replace />
  return roles.includes(session.role) ? children : <Navigate to="/dashboard" replace />
}

// ── root component ────────────────────────────────────────────────────────────

import { useState } from 'react'

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [activeLanguage, setActiveLanguage] = useState(() => localStorage.getItem('avani-language') || 'English')

  // Linear-style cursor spotlight: track the pointer over glass cards and
  // expose its position as CSS vars consumed by the card ::after glow.
  useEffect(() => {
    const onMove = (e) => {
      const el = e.target?.closest?.('.panel-section, .stat-card, .prop-card')
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const updateSession = (s) => { setSession(s); saveSession(s) }

  const changeLanguage = (language) => {
    setActiveLanguage(language)
    localStorage.setItem('avani-language', language)
  }

  const sharedProps = {
    onLogout:         () => updateSession(null),
    activeLanguage,
    onLanguageChange: changeLanguage,
  }

  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      {/* Landing / login */}
      <Route path="/"        element={<Home session={session} setSession={updateSession} />} />
      {/* /landing kept for backwards-compat deep links */}
      <Route path="/landing" element={<Home session={session} setSession={updateSession} />} />
      <Route path="/login"   element={<LoginRoute session={session} setSession={updateSession} />} />

      {/* Public: the page every UPC QR code opens */}
      <Route path="/verify/:code" element={<Verify />} />

      {/* Main dashboard */}
      <Route path="/dashboard" element={<Dashboard session={session} {...sharedProps} />} />

      {/* the old passport links now open the Unified Property Card */}
      <Route path="/passport/:id" element={<ToRor />} />
      <Route path="/portal/passport/:id" element={<ToRor />} />

      <Route path="/portal/building/:id/3d" element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps}><Building3DView /></PageShell></Only>} />
      {/* Portal pages */}
      <Route path="/portal/property/:id" element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="1160px"><PropertyDetails /></PageShell></Only>} />
      <Route path="/portal/records"      element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="1100px"><PropertyRecords /></PageShell></Only>} />
      <Route path="/portal/upc/:id"      element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="800px"><UnifiedPropertyCard /></PageShell></Only>} />
      <Route path="/portal/report/:unitId" element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="800px"><ComplaintForm /></PageShell></Only>} />
      <Route path="/portal/card/:unitId" element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="760px"><UnitUpc /></PageShell></Only>} />
      <Route path="/portal/profile"      element={<Only session={session} roles={['citizen']}><PageShell session={session} {...sharedProps} maxW="800px"><Profile onLogout={() => updateSession(null)} /></PageShell></Only>} />

      {/* 3D ULPIN view — lazy-loaded, wrapped in ErrorBoundary */}
      <Route
        path="/ulpin"
        element={
          <Only session={session} roles={['citizen', ...STAFF]}>
          <div className="app">
            <Topbar session={session} onLogout={() => updateSession(null)} activeLanguage={activeLanguage} onLanguageChange={changeLanguage} />
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <UlpinView session={session} />
              </Suspense>
            </ErrorBoundary>
          </div>
          </Only>
        }
      />

      {/* LiDAR footprint extraction — surveyor/registrar only */}
      <Route
        path="/lidar"
        element={
          <Only session={session} roles={STAFF}>
          <div className="app">
            <Topbar session={session} onLogout={() => updateSession(null)} activeLanguage={activeLanguage} onLanguageChange={changeLanguage} />
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <LidarMap
                  canEdit={session?.role === 'surveyor' || session?.role === 'registrar'}
                  user={session ? { name: session.name, role: session.role, username: session.username ?? session.name } : null}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
          </Only>
        }
      />

      {/* Point cloud viewer — three.js PLY viewer */}
      <Route
        path="/pointcloud"
        element={
          <Only session={session} roles={STAFF}>
          <div className="app">
            <Topbar session={session} onLogout={() => updateSession(null)} activeLanguage={activeLanguage} onLanguageChange={changeLanguage} />
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <PointCloudViewer session={session} />
              </Suspense>
            </ErrorBoundary>
          </div>
          </Only>
        }
      />

      {/* Oblique imagery manager */}
      <Route
        path="/oblique"
        element={
          <Only session={session} roles={STAFF}>
          <div className="app">
            <Topbar session={session} onLogout={() => updateSession(null)} activeLanguage={activeLanguage} onLanguageChange={changeLanguage} />
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <ObliqueImagery session={session} />
              </Suspense>
            </ErrorBoundary>
          </div>
          </Only>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  )
}

// ── route-level components ────────────────────────────────────────────────────

function ToRor() {
  const { id } = useParams()
  return <Navigate to={`/portal/card/${encodeURIComponent(id)}`} replace />
}

function Home({ session, setSession }) {
  const navigate = useNavigate()
  if (session) return <Navigate to="/dashboard" replace />
  return (
    <Landing
      onLogin={(s) => { setSession(s); navigate('/dashboard') }}
    />
  )
}

function LoginRoute({ session, setSession }) {
  const navigate  = useNavigate()
  const [params]  = useSearchParams()
  if (session) return <Navigate to="/dashboard" replace />

  return (
    <Login
      initialRole={params.get('role') || 'citizen'}
      onLogin={(s) => { setSession(s); navigate('/dashboard') }}
      onBack={() => navigate('/')}
    />
  )
}
