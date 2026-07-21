import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { StaffService } from '@/services/staff.service'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest, context: any) {
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

    const employee = await StaffService.getEmployeeById(BigInt(params.id), organizationId)
    if (!employee) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
    }
    
    const serialized = {
      ...employee,
      id: employee.id.toString(),
      organization_id: employee.organization_id.toString(),
      branch_id: employee.branch_id?.toString(),
      user_id: employee.user_id?.toString(),
      base_salary: employee.base_salary.toString()
    }

    return NextResponse.json({ success: true, data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

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

    const employee = await StaffService.getEmployeeById(BigInt(params.id), organizationId)
    if (!employee) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 })
    }

    const body = await req.json()
    const { first_name, last_name, email, phone, department, designation, base_salary, status, branch_id } = body

    const data: any = {}
    if (first_name !== undefined) data.first_name = first_name
    if (last_name !== undefined) data.last_name = last_name
    if (email !== undefined) data.email = email
    if (phone !== undefined) data.phone = phone
    if (department !== undefined) data.department = department
    if (designation !== undefined) data.designation = designation
    if (base_salary !== undefined) data.base_salary = base_salary
    if (status !== undefined) data.status = status
    if (branch_id !== undefined) data.branch_id = branch_id ? BigInt(branch_id) : null

    const updated = await StaffService.updateEmployee(BigInt(params.id), data)

    const serialized = {
      ...updated,
      id: updated.id.toString(),
      organization_id: updated.organization_id.toString(),
      branch_id: updated.branch_id?.toString(),
      user_id: updated.user_id?.toString(),
      base_salary: updated.base_salary.toString()
    }

    return NextResponse.json({ success: true, message: 'Employee updated successfully', data: serialized })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
