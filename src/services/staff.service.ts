import { prisma } from '@/lib/prisma'

export class StaffService {
  // ---------------------------------------------------------------------------
  // EMPLOYEES
  // ---------------------------------------------------------------------------
  static async getEmployees(organizationId: bigint) {
    return prisma.employee.findMany({
      where: { organization_id: organizationId, is_deleted: false },
      include: {
        Branch: true,
        User: {
          select: { id: true, email: true, first_name: true, last_name: true }
        }
      },
      orderBy: { created_at: 'desc' }
    })
  }

  static async getEmployeeById(id: bigint, organizationId: bigint) {
    return prisma.employee.findFirst({
      where: { id, organization_id: organizationId, is_deleted: false },
      include: { Branch: true, User: true }
    })
  }

  static async createEmployee(data: any) {
    return prisma.employee.create({
      data
    })
  }

  static async updateEmployee(id: bigint, data: any) {
    return prisma.employee.update({
      where: { id },
      data
    })
  }

  // ---------------------------------------------------------------------------
  // ATTENDANCE
  // ---------------------------------------------------------------------------
  static async getAttendance(organizationId: bigint, filters: any = {}) {
    const where: any = { organization_id: organizationId }
    if (filters.employee_id) where.employee_id = filters.employee_id
    if (filters.startDate && filters.endDate) {
      where.date = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate)
      }
    } else if (filters.date) {
      where.date = new Date(filters.date)
    }

    return prisma.attendance.findMany({
      where,
      include: {
        Employee: { select: { id: true, first_name: true, last_name: true, employee_code: true } }
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }]
    })
  }

  static async clockIn(organizationId: bigint, employeeId: bigint, notes?: string, customTime?: Date) {
    const timestamp = customTime ? new Date(customTime) : new Date()
    const today = new Date(timestamp)
    today.setUTCHours(0, 0, 0, 0)

    // Check if already clocked in today
    const existing = await prisma.attendance.findFirst({
      where: { employee_id: employeeId, date: today }
    })

    if (existing) {
      if (existing.clock_in) throw new Error('Already clocked in for this date.')
      return prisma.attendance.update({
        where: { id: existing.id },
        data: { clock_in: timestamp, status: 'PRESENT', notes: notes || existing.notes }
      })
    }

    return prisma.attendance.create({
      data: {
        organization_id: organizationId,
        employee_id: employeeId,
        date: today,
        clock_in: timestamp,
        status: 'PRESENT',
        notes
      }
    })
  }

  static async clockOut(organizationId: bigint, employeeId: bigint, notes?: string, customTime?: Date) {
    const timestamp = customTime ? new Date(customTime) : new Date()
    const today = new Date(timestamp)
    today.setUTCHours(0, 0, 0, 0)

    const existing = await prisma.attendance.findFirst({
      where: { employee_id: employeeId, date: today }
    })

    if (!existing || !existing.clock_in) {
      throw new Error('Must clock in before clocking out for this date.')
    }

    return prisma.attendance.update({
      where: { id: existing.id },
      data: { clock_out: timestamp, notes: notes || existing.notes }
    })
  }

  // ---------------------------------------------------------------------------
  // PAYROLL
  // ---------------------------------------------------------------------------
  static async getPayrolls(organizationId: bigint, employeeId?: bigint) {
    const where: any = { organization_id: organizationId }
    if (employeeId) where.employee_id = employeeId

    return prisma.payroll.findMany({
      where,
      include: {
        Employee: { select: { id: true, first_name: true, last_name: true, employee_code: true } }
      },
      orderBy: { period_start: 'desc' }
    })
  }

  static async generatePayroll(organizationId: bigint, data: { employee_id: bigint, period_start: string, period_end: string, basic_salary: number, allowances: number, deductions: number }) {
    const net_salary = data.basic_salary + data.allowances - data.deductions
    
    return prisma.payroll.create({
      data: {
        organization_id: organizationId,
        employee_id: data.employee_id,
        period_start: new Date(data.period_start),
        period_end: new Date(data.period_end),
        basic_salary: data.basic_salary,
        allowances: data.allowances,
        deductions: data.deductions,
        net_salary,
        status: 'PENDING'
      }
    })
  }

  static async updatePayrollStatus(id: bigint, status: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED', paymentMethod?: string) {
    const dataToUpdate: any = { status }
    if (status === 'PAID') {
      dataToUpdate.payment_date = new Date()
      if (paymentMethod) dataToUpdate.payment_method = paymentMethod
    }
    return prisma.payroll.update({
      where: { id },
      data: dataToUpdate
    })
  }

  // ---------------------------------------------------------------------------
  // PRODUCTIVITY
  // ---------------------------------------------------------------------------
  static async getProductivityMetrics(organizationId: bigint, employeeId?: bigint) {
    const where: any = { organization_id: organizationId }
    if (employeeId) where.employee_id = employeeId

    return prisma.productivityMetric.findMany({
      where,
      include: {
        Employee: { select: { id: true, first_name: true, last_name: true, employee_code: true } },
        Evaluator: { select: { id: true, first_name: true, last_name: true } }
      },
      orderBy: { date: 'desc' }
    })
  }

  static async createProductivityMetric(data: any) {
    return prisma.productivityMetric.create({
      data
    })
  }
}
