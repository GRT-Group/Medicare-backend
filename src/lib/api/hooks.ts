import { useState, useEffect, useCallback } from 'react'
import { api } from './client'
import type { User, ApiResponse } from './types'

const LOGIN_PATHS = ['/login', '/auth/login', '/register', '/forgot-password', '/reset-password']

function shouldRedirectToLogin() {
  if (typeof window === 'undefined') return false
  return !LOGIN_PATHS.includes(window.location.pathname)
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const redirectToLogin = useCallback(() => {
    if (shouldRedirectToLogin()) {
      window.location.replace('/login')
    }
  }, [])

  const checkAuth = useCallback(async () => {
    if (!api.isAuthenticated()) {
      setUser(null)
      setLoading(false)
      setIsAuthenticated(false)
      redirectToLogin()
      return
    }

    try {
      const response = await api.validateToken()
      if (response.success && response.data) {
        setUser(response.data)
        setIsAuthenticated(true)
      } else {
        api.clearAuth()
        setUser(null)
        setIsAuthenticated(false)
        redirectToLogin()
      }
    } catch (error) {
      api.clearAuth()
      setUser(null)
      setIsAuthenticated(false)
      redirectToLogin()
    } finally {
      setLoading(false)
    }
  }, [redirectToLogin])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const logout = useCallback(() => {
    api.clearAuth()
    setUser(null)
    setIsAuthenticated(false)
    redirectToLogin()
  }, [redirectToLogin])

  return {
    user,
    setUser,
    loading,
    isAuthenticated,
    logout,
    checkAuth,
    api
  }
}

export function useApi<T>(
  apiCall: () => Promise<ApiResponse<T>>,
  autoFetch = true
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall()
      if (response.success) {
        setData(response.data || null)
      } else {
        setError(response.error || 'An error occurred')
      }
    } catch (err) {
      setError('An error occurred')
    } finally {
      setLoading(false)
    }
  }, [apiCall])

  useEffect(() => {
    if (autoFetch) {
      fetch()
    }
  }, [fetch, autoFetch])

  return {
    data,
    loading,
    error,
    fetch,
    setData
  }
}

export function useDashboard() {
  return useApi(() => api.getDashboard())
}

export function useProducts() {
  return useApi(() => api.getProducts())
}

export function useSales() {
  return useApi(() => api.getSales())
}

export function useCustomers() {
  return useApi(() => api.getCustomers())
}

export function useSuppliers() {
  return useApi(() => api.getSuppliers())
}

export function useBranches() {
  return useApi(() => api.getBranches())
}

export function useNotificationPreferences() {
  return useApi(() => api.getNotificationPreferences())
}

export function useProfile() {
  return useApi(() => api.getProfile())
}
