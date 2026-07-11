import type {
  ApiResponse,
  User,
  LoginCredentials,
  LoginResponse,
  VerifyOtpData,
  VerifyOtpResponse,
  RegisterData,
  RegisterResponse,
  ForgotPasswordData,
  ResetPasswordData,
  NotificationPreferences,
  DashboardData,
  Product,
  Sale,
  Customer,
  Supplier,
  Branch,
  Organization
} from './types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

class ApiClient {
  private token: string | null = null
  private organizationId: string | null = null
  private userId: string | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('auth_token')
      this.organizationId = localStorage.getItem('organization_id')
      this.userId = localStorage.getItem('user_id')
    }
  }

  setToken(token: string) {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token)
    }
  }

  setOrganizationId(organizationId: string) {
    this.organizationId = organizationId || null
    if (typeof window !== 'undefined') {
      if (this.organizationId) {
        localStorage.setItem('organization_id', this.organizationId)
      } else {
        localStorage.removeItem('organization_id')
      }
    }
  }

  setUserId(userId: string) {
    this.userId = userId
    if (typeof window !== 'undefined') {
      localStorage.setItem('user_id', userId)
    }
  }

  clearAuth() {
    this.token = null
    this.organizationId = null
    this.userId = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('organization_id')
      localStorage.removeItem('user_id')
    }
  }

  isAuthenticated(): boolean {
    return !!this.token
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    if (this.organizationId) {
      headers['x-organization-id'] = this.organizationId
    }

    if (this.userId) {
      headers['x-user-id'] = this.userId
    }

    return headers
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    })

    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error || data.message || 'An error occurred'
      const shouldClearAuth =
        response.status === 401 &&
        (endpoint === '/auth/validate' || /session expired|invalid token/i.test(errorMessage))

      if (shouldClearAuth) {
        this.clearAuth()
      }

      return {
        success: false,
        error: errorMessage
      }
    }

    return data
  }

  // Authentication endpoints
  async login(credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    })
  }

  async verifyOtp(data: VerifyOtpData): Promise<ApiResponse<VerifyOtpResponse>> {
    const response = await this.request<VerifyOtpResponse>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(data)
    })

    if (response.success && response.data?.token) {
      const user = response.data.user as any
      this.setToken(response.data.token)
      this.setUserId(user.id)
      this.setOrganizationId(user.organization_id || user.organizationId || '')
    }

    return response
  }

  async register(data: RegisterData): Promise<ApiResponse<RegisterResponse>> {
    return this.request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async forgotPassword(data: ForgotPasswordData): Promise<ApiResponse> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async resetPassword(data: ResetPasswordData): Promise<ApiResponse> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async validateToken(): Promise<ApiResponse<User>> {
    return this.request<User>('/auth/validate')
  }

  // Notification preferences
  async getNotificationPreferences(): Promise<ApiResponse<NotificationPreferences>> {
    return this.request<NotificationPreferences>('/notifications/preferences')
  }

  async updateNotificationPreferences(preferences: NotificationPreferences): Promise<ApiResponse<NotificationPreferences>> {
    return this.request<NotificationPreferences>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences)
    })
  }

  // User profile
  async getProfile(): Promise<ApiResponse<User>> {
    return this.request<User>('/users/profile')
  }

  async updateProfile(data: Partial<User>): Promise<ApiResponse<User>> {
    return this.request<User>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async changePassword(data: { currentPassword: string; newPassword: string }): Promise<ApiResponse> {
    return this.request('/users/profile/change-password', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Dashboard
  async getDashboard(): Promise<ApiResponse<DashboardData>> {
    return this.request<DashboardData>('/dashboard')
  }

  // Products
  async getProducts(): Promise<ApiResponse<Product[]>> {
    return this.request<Product[]>('/products')
  }

  async createProduct(data: Partial<Product>): Promise<ApiResponse<Product>> {
    return this.request<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Sales
  async getSales(): Promise<ApiResponse<Sale[]>> {
    return this.request<Sale[]>('/sales')
  }

  async createSale(data: Partial<Sale>): Promise<ApiResponse<Sale>> {
    return this.request<Sale>('/sales', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Customers
  async getCustomers(): Promise<ApiResponse<Customer[]>> {
    return this.request<Customer[]>('/customers')
  }

  async createCustomer(data: Partial<Customer>): Promise<ApiResponse<Customer>> {
    return this.request<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Suppliers
  async getSuppliers(): Promise<ApiResponse<Supplier[]>> {
    return this.request<Supplier[]>('/suppliers')
  }

  async createSupplier(data: Partial<Supplier>): Promise<ApiResponse<Supplier>> {
    return this.request<Supplier>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Branches
  async getBranches(): Promise<ApiResponse<Branch[]>> {
    return this.request<Branch[]>('/branches')
  }

  async createBranch(data: Partial<Branch>): Promise<ApiResponse<Branch>> {
    return this.request<Branch>('/branches', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Organization
  async getOrganization(): Promise<ApiResponse<Organization>> {
    return this.request<Organization>('/organizations')
  }

  // Health check
  async healthCheck(): Promise<ApiResponse> {
    return this.request('/health')
  }
}

export const api = new ApiClient()




