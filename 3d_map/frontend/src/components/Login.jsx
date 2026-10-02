import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { login } from '../api.js'
import CubeMark from './CubeMark.jsx'

const ROLES = [
  {
    id: 'citizen',
    title: 'Citizen',
    blurb: 'view your units, file disputes, inspect ownership history',
    username: 'ramesh',
    password: 'citizen123',
    icon: '🏠',
  },
  {
    id: 'surveyor',
    title: 'Surveyor',
    blurb: 'upload floor plans, split units, run conflict validation',
    username: 'priya',
    password: 'survey123',
    icon: '📐',
  },
  {
    id: 'registrar',
    title: 'Registrar',
    blurb: 'review disputes, audit hash-chained ledgers, publish to NGDRS',
    username: 'arun',
    password: 'register123',
    icon: '🏛️',
  },
]

export default function Login({ onLogin, onBack, initialRole = 'citizen' }) {
  const initial = ROLES.find((r) => r.id === initialRole) || ROLES[0]
  const [role, setRole] = useState(initial.id)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState(initial.password)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const active = ROLES.find((r) => r.id === role)

  const pickRole = (r) => {
    setRole(r.id)
    setUsername(r.username)
    setPassword(r.password)
    setError(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await login(username, password, role)
      onLogin(session)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        {onBack && (
          <button type="button" className="login-back" onClick={onBack}>
            ← back to overview
          </button>
        )}
        <div className="login-head">
          <div className="brand-mark login-mark" aria-label="Avani logo">
            <CubeMark size={30} tint="#8B93E8" />
          </div>
          <div>
            <h1>Avani</h1>
            <p className="muted tiny">Government of India · National Urban Cadastre · Demo</p>
          </div>
        </div>

        <div className="login-roles">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`login-role ${role === r.id ? 'active' : ''}`}
              onClick={() => pickRole(r)}
              disabled={busy}
            >
              <span className="login-role-icon">{r.icon}</span>
              <span>
                <strong>{r.title}</strong>
                <em className="tiny muted">{r.blurb}</em>
              </span>
            </button>
          ))}
        </div>

        <label className="login-field">
          <span>username</span>
          <input
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(null) }}
            placeholder={active.username}
            autoFocus
            autoComplete="username"
            disabled={busy}
          />
        </label>
        <label className="login-field">
          <span>password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null) }}
            placeholder="••••••••"
            autoComplete="current-password"
            disabled={busy}
          />
        </label>

        {error && <div className="login-error">⚠ {error}</div>}

        <button className="btn primary login-submit" disabled={busy || !username || !password}>
          {busy ? 'signing in…' : `sign in as ${active.title.toLowerCase()}`}
        </button>

        <div className="login-hint tiny muted">
          demo credentials pre-filled per role — {active.username} / {active.password}
        </div>
      </form>
    </div>
  )
}
