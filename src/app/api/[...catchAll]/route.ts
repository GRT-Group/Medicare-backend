import { NextResponse } from 'next/server';

const notFoundResponse = () => {
  return NextResponse.json(
    { success: false, error: 'The requested endpoint does not exist.' },
    { status: 404 }
  );
};

export async function GET() { return notFoundResponse(); }
export async function POST() { return notFoundResponse(); }
export async function PUT() { return notFoundResponse(); }
export async function PATCH() { return notFoundResponse(); }
export async function DELETE() { return notFoundResponse(); }
export async function OPTIONS() { return notFoundResponse(); }
