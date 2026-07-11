import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { CashbookService } from '@/services/cashbook.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const expenses = await CashbookService.getExpenses(BigInt(orgId));
    
    // Formatted for frontend
    const formatted = expenses.map((e: any) => ({
      expense: {
        id: e.id,
        type: e.category,
        amount: e.amount,
        note: e.description,
        createdBy: e.created_by_id,
        createdAt: e.date
      }
    }));

    return NextResponse.json(formatted, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id') || '1'; // Fallback
    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const body = await req.json();
    
    if (!body.category || body.amount === undefined) {
      return NextResponse.json({ error: 'Missing category or amount' }, { status: 400 });
    }

    const expense = await CashbookService.createExpense(BigInt(orgId), {
      category: body.category,
      amount: Number(body.amount),
      description: body.note // mapping frontend 'note' to DB 'description'
    }, BigInt(adminId));

    return NextResponse.json({ message: 'Expense recorded successfully', expense }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or expense ID' }, { status: 400 });

    const body = await req.json();
    const expense = await CashbookService.updateExpense(BigInt(id), BigInt(orgId), {
      category: body.category,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      description: body.note,
      status: body.status
    });
    return NextResponse.json(expense, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const adminId = req.headers.get('x-user-id');
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!orgId || !id) return NextResponse.json({ error: 'Missing organization ID or expense ID' }, { status: 400 });

    await CashbookService.deleteExpense(BigInt(id), BigInt(orgId), adminId ? BigInt(adminId) : BigInt(0));
    return NextResponse.json({ message: 'Expense deleted successfully' }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
