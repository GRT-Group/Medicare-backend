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

    const records = await StaffService.getProductivityMetrics(organizationId, employee_id ? BigInt(employee_id) : undefined)
    
    const serialized = records.map(rec => ({
      ...rec,
      id: rec.id.toString(),
      organization_id: rec.organization_id.toString(),
      employee_id: rec.employee_id.toString(),
      evaluator_id: rec.evaluator_id?.toString(),
      metric_value: rec.metric_value.toString(),
      Employee: {
        ...rec.Employee,
        id: rec.Employee.id.toString()
      },
      Evaluator: rec.Evaluator ? {
        ...rec.Evaluator,
        id: rec.Evaluator.id.toString()
      } : null
    }))

    return NextResponse.json({ success: true, data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

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
    const { employee_id, metric_type, metric_value, date, notes } = body

    if (!employee_id || !metric_type || metric_value === undefined || !date) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const metric = await StaffService.createProductivityMetric({
      organization_id: organizationId,
      employee_id: BigInt(employee_id),
      metric_type,
      metric_value: Number(metric_value),
      date: new Date(date),
      evaluator_id: BigInt(decoded.id),
      notes
    })

    const serialized = {
      ...metric,
      id: metric.id.toString(),
      organization_id: metric.organization_id.toString(),
      employee_id: metric.employee_id.toString(),
      evaluator_id: metric.evaluator_id?.toString(),
      metric_value: metric.metric_value.toString()
    }

    return NextResponse.json({ success: true, message: 'Productivity metric recorded successfully', data: serialized }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
