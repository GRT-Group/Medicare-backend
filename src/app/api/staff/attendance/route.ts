import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { StaffService } from '@/services/staff.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url)
    const employee_id = searchParams.get('employee_id')
    const date = searchParams.get('date')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const filters: any = {}
    if (employee_id) filters.employee_id = BigInt(employee_id)
    if (date) filters.date = date
    if (startDate) filters.startDate = startDate
    if (endDate) filters.endDate = endDate

    const records = await StaffService.getAttendance(organizationId, filters)
    
    const serialized = records.map(rec => ({
      ...rec,
      id: rec.id.toString(),
      organization_id: rec.organization_id.toString(),
      employee_id: rec.employee_id.toString(),
      Employee: {
        ...rec.Employee,
        id: rec.Employee.id.toString()
      }
    }))

    return NextResponse.json({ success: true, data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
