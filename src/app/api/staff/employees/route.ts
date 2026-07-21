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

    const employees = await StaffService.getEmployees(organizationId)
    
    // Serialize bigints for JSON response
    const serialized = employees.map((emp: any) => ({
      ...emp,
      id: emp.id.toString(),
      organization_id: emp.organization_id.toString(),
      branch_id: emp.branch_id?.toString(),
      user_id: emp.user_id?.toString(),
      base_salary: emp.base_salary.toString()
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
    const { employee_code, first_name, last_name, email, phone, department, designation, base_salary, branch_id, user_id } = body

    if (!employee_code || !first_name || !last_name) {
      return NextResponse.json({ success: false, error: 'Missing required fields: employee_code, first_name, last_name' }, { status: 400 })
    }

    const newEmployee = await StaffService.createEmployee({
      organization_id: organizationId,
      branch_id: branch_id ? BigInt(branch_id) : undefined,
      user_id: user_id ? BigInt(user_id) : undefined,
      employee_code,
      first_name,
      last_name,
      email,
      phone,
      department,
      designation,
      base_salary: base_salary || 0
    })

    const serialized = {
      ...newEmployee,
      id: newEmployee.id.toString(),
      organization_id: newEmployee.organization_id.toString(),
      branch_id: newEmployee.branch_id?.toString(),
      user_id: newEmployee.user_id?.toString(),
      base_salary: newEmployee.base_salary.toString()
    }

    return NextResponse.json({ success: true, message: 'Employee created successfully', data: serialized }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 400 })
  }
}
