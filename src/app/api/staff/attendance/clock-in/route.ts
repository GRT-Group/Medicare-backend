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
    const { employee_id, notes, timestamp } = body
    const time = timestamp ? new Date(timestamp) : undefined

    if (!employee_id) {
      return NextResponse.json({ success: false, error: 'Missing required field: employee_id' }, { status: 400 })
    }

    const attendance = await StaffService.clockIn(organizationId, BigInt(employee_id), notes, time)

    const serialized = {
      ...attendance,
      id: attendance.id.toString(),
      organization_id: attendance.organization_id.toString(),
      employee_id: attendance.employee_id.toString()
    }

    return NextResponse.json({ success: true, message: 'Clocked in successfully', data: serialized }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
