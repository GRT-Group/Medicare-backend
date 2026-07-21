import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { StaffService } from '@/services/staff.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'Forbidden: No organization assigned' }, { status: 403 })
    }

    const body = await req.json()
    const { employee_id, period_start, period_end, basic_salary, allowances, deductions } = body

    if (!employee_id || !period_start || !period_end || basic_salary === undefined) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const payroll = await StaffService.generatePayroll(organizationId, {
      employee_id: BigInt(employee_id),
      period_start,
      period_end,
      basic_salary: Number(basic_salary),
      allowances: Number(allowances || 0),
      deductions: Number(deductions || 0)
    })

    const serialized = {
      ...payroll,
      id: payroll.id.toString(),
      organization_id: payroll.organization_id.toString(),
      employee_id: payroll.employee_id.toString(),
      basic_salary: payroll.basic_salary.toString(),
      allowances: payroll.allowances.toString(),
      deductions: payroll.deductions.toString(),
      net_salary: payroll.net_salary.toString()
    }

    return NextResponse.json({ success: true, message: 'Payroll generated successfully', data: serialized }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
