'use client'

import { useState } from 'react'
import { api, useApi, useAuth, useDashboard } from '@/lib/api'

export function LoginExample() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showOtp, setShowOtp] = useState(false)
  const [userId, setUserId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { checkAuth } = useAuth()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await api.login({ identifier: email, password })
      
      if (!result.success) {
        setError(result.error || 'Login failed')
        return
      }

      if (result.data?.requireOtp) {
        setUserId(result.data.userId)
        setShowOtp(true)
      }
    } catch (err) {
      setError('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await api.verifyOtp({ userId, code: otp })
      
      if (!result.success) {
        setError(result.error || 'OTP verification failed')
        return
      }

      // Success! Refresh auth state
      await checkAuth()
    } catch (err) {
      setError('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (showOtp) {
    return (
      <form onSubmit={handleVerifyOtp}>
        <h2>Enter OTP</h2>
        {error && <div className="error">{error}</div>}
        <input
          type="text"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          placeholder="Enter 6-digit OTP"
          maxLength={6}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleLogin}>
      <h2>Login</h2>
      {error && <div className="error">{error}</div>}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email or Phone"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  )
}

export function DashboardExample() {
  const { user, logout } = useAuth()
  const { data: dashboard, loading } = useDashboard()

  if (loading) {
    return <div>Loading dashboard...</div>
  }

  return (
    <div>
      <header>
        <h1>Welcome, {user?.first_name}!</h1>
        <button onClick={logout}>Logout</button>
      </header>

      <div className="stats">
        <div className="stat">
          <h3>Sales Today</h3>
          <p>{dashboard?.sales_today?.toLocaleString()}</p>
        </div>
        <div className="stat">
          <h3>Purchases Today</h3>
          <p>{dashboard?.purchases_today?.toLocaleString()}</p>
        </div>
        <div className="stat">
          <h3>Profit Today</h3>
          <p>{dashboard?.profit_today?.toLocaleString()}</p>
        </div>
        <div className="stat">
          <h3>Total Products</h3>
          <p>{dashboard?.total_products}</p>
        </div>
      </div>

      <div className="recent-sales">
        <h2>Recent Sales</h2>
        {dashboard?.recent_sales?.map((sale) => (
          <div key={sale.id}>
            <p>{sale.invoice_number} - {sale.total_amount}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NotificationPreferencesExample() {
  const { data: prefs, fetch } = useApi(() => api.getNotificationPreferences())
  const [saving, setSaving] = useState(false)

  const handleUpdate = async (smsEnabled: boolean, emailEnabled: boolean) => {
    if (!smsEnabled && !emailEnabled) {
      alert('You must enable at least one notification channel!')
      return
    }

    setSaving(true)
    try {
      await api.updateNotificationPreferences({ smsEnabled, emailEnabled })
      await fetch() // Refresh
    } catch (err) {
      console.error('Failed to update preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2>Notification Preferences</h2>
      <label>
        <input
          type="checkbox"
          checked={prefs?.smsEnabled}
          onChange={(e) => handleUpdate(e.target.checked, prefs?.emailEnabled ?? true)}
          disabled={saving}
        />
        SMS Notifications
      </label>
      <label>
        <input
          type="checkbox"
          checked={prefs?.emailEnabled}
          onChange={(e) => handleUpdate(prefs?.smsEnabled ?? true, e.target.checked)}
          disabled={saving}
        />
        Email Notifications
      </label>
    </div>
  )
}
