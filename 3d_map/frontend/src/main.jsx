import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './demo.css'
import './styles.css'
import { installDemoServer } from './demo/demoServer.js'

// Frontend-only hosting (npm run build:demo): answer /api calls in the browser from a snapshot
if (import.meta.env.VITE_STATIC_DEMO) installDemoServer()

// Automatically reload the page if a new deployment invalidates old hashed chunks (common on Vercel)
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ErrorBoundary>,
)
