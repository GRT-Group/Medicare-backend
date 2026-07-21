import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { StaffService } from '@/services/staff.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function PUT(req: NextRequest, context: any) {
  const params = await Promise.resolve(context.params)
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
    const { status, payment_method } = body

    if (!status || !['PENDING', 'APPROVED', 'PAID', 'CANCELLED'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid or missing status' }, { status: 400 })
    }

    const updated = await StaffService.updatePayrollStatus(BigInt(params.id), status, payment_method)

    const serialized = {
      ...updated,
      id: updated.id.toString(),
      organization_id: updated.organization_id.toString(),
      employee_id: updated.employee_id.toString(),
      basic_salary: updated.basic_salary.toString(),
      allowances: updated.allowances.toString(),
      deductions: updated.deductions.toString(),
      net_salary: updated.net_salary.toString()
    }

    return NextResponse.json({ success: true, message: 'Payroll status updated', data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
