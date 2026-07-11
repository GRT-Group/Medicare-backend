export interface ApiResponse<T = any> {
  success: boolean
  message?: string
  data?: T
  error?: string
}

export interface User {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  firstName?: string
  lastName?: string
  role_id: string
  roleId?: string
  organization_id: string
  organizationId?: string
  branch_id?: string
  status: string
  sms_notification_active: boolean
  email_notification_active: boolean
  role?: {
    id: string
    name: string
  }
  organization?: {
    id: string
    name: string
    status: string
  }
}

export interface Organization {
  id: string
  name: string
  code: string
  organization_type_id: string
  phone: string
  firstName?: string
  lastName?: string
  email: string
  country?: string
  timezone: string
  currency: string
  status: string
  is_approved: boolean
  created_at: string
  updated_at: string
}

export interface Branch {
  id: string
  organization_id: string
  organizationId?: string
  name: string
  location?: string
  contact_info?: string
  is_main: boolean
  status: string
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  name: string
  barcode?: string
  category_id: string
  organization_id: string
  organizationId?: string
  unit_of_measure: string
  base_cost: number
  base_price: number
  tax_rate: number
  reorder_level: number
  status: string
  image_url?: string
  lifecycle_status: string
  created_at: string
  updated_at: string
  category?: {
    id: string
    name: string
  }
  batches?: ProductBatch[]
}

export interface ProductBatch {
  id: string
  product_id: string
  batch_number: string
  expiry_date?: string
  quantity_remaining: number
  unit_cost: number
  selling_price: number
  status: string
  supplier_id?: string
}

export interface Sale {
  id: string
  invoice_number: string
  customer_id?: string
  total_amount: number
  amount_paid: number
  remaining_balance: number
  payment_method: string
  status: string
  branch_id?: string
  created_at: string
  customer?: {
    id: string
    name: string
  }
  items?: SaleItem[]
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string
  batch_id: string
  quantity: number
  unit_price: number
  subtotal: number
  status: string
}

export interface Customer {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  customer_type: string
  loyalty_points: number
  credit_limit: number
  current_balance: number
  status: string
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  name: string
  contact_info?: string
  payment_terms?: string
  outstanding_balance: number
  status: string
  created_at: string
  updated_at: string
}

export interface DashboardData {
  role?: {
    id: string
    name: string
    is_super_admin: boolean
  }
  scope?: {
    type: 'GLOBAL' | 'ORGANIZATION'
    organization_id?: string
  }
  sales_today: number
  purchases_today: number
  profit_today: number
  total_products: number
  low_stock_products: number
  expired_products: number
  revenue?: number
  expenses?: number
  purchases?: number
  creditExposure?: number
  stockValue?: number
  netCashFlow?: number
  organizations_total?: number
  active_organizations?: number
  pending_organization_approvals?: number
  total_branches?: number
  total_users?: number
  active_subscriptions?: number
  pending_subscription_approvals?: number
  open_support_tickets?: number
  pending_payments?: number
  low_stock_alert_count?: number
  expired_product_alert_count?: number
  recent_organizations?: Array<{
    id: string
    name: string
    status: string
    is_approved: boolean
    created_at: string
    updated_at: string
    lifecycle_status: string
  }>
  recent_branches?: Array<{
    id: string
    organization_id: string
    name: string
    status: string
    created_at: string
  }>
  recent_users?: Array<{
    id: string
    first_name: string
    last_name: string
    email: string
    organization_id: string | null
    role_id: string
    created_at: string
  }>
  recent_tickets?: Array<{
    id: string
    organization_id: string
    subject: string
    status: string
    priority: string
    created_at: string
  }>
  recent_payments?: Array<{
    id: string
    organization_id: string
    amount: number
    status: string
    date: string
    payment_method: string
  }>
  recent_audit_logs?: Array<{
    id: string
    organization_id: string
    user_id: string
    action: string
    table_affected: string
    timestamp: string
  }>
  top_organizations_by_revenue?: Array<{
    organization_id: string
    organization_name: string
    revenue: number
  }>
  top_selling_products: Array<{
    product_name: string
    quantity_sold: number
    revenue: number
  }>
  recent_sales: Array<{
    id: string
    invoice_number: string
    total_amount: number
    created_at: string
    branch_name?: string | null
    organization_id?: string
    branch_id?: string | null
  }>
  analytics?: {
    salesTrend?: Array<{ date: string; amount: number }>
    profitTrend?: Array<{ date: string; amount: number }>
    forecastNextMonth?: number
    branchPerformance?: Array<{ branch: string; revenue: number; profit: number }>
    topSellingProducts?: Array<{ product_name: string; quantity_sold: number; revenue: number }>
    staffPerformance?: Array<{ staff: string; revenue: number; salesCount: number }>
    lowStockAlerts?: Array<{ productName: string; currentStock: number; reorderLevel: number }>
  }
}

export interface NotificationPreferences {
  smsEnabled: boolean
  emailEnabled: boolean
}

export interface LoginCredentials {
  identifier: string
  password: string
}

export interface LoginResponse {
  requireOtp: boolean
  userId: string
  user: User
}

export interface VerifyOtpData {
  userId: string
  code: string
}

export interface VerifyOtpResponse {
  token: string
  user: User
}

export interface RegisterData {
  organizationName: string
  organizationTypeId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  password: string
  businessUnit?: string
  taxId?: string
  registrationNumber?: string
  licenseNumber?: string
  website?: string
  address?: {
    country: string
    city: string
  }
  businessLicenseUrl?: string
}

export interface RegisterResponse {
  organizationId: string
  userId: string
}

export interface ForgotPasswordData {
  identifier: string
}

export interface ResetPasswordData {
  identifier: string
  code: string
  newPassword: string
  confirmPassword: string
}



