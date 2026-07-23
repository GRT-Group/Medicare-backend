import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const senderId = BigInt(decoded.id)
    const messageId = BigInt(params.id)
    
    const body = await req.json()
    const { content } = body

    if (!content) {
      return NextResponse.json({ success: false, error: 'Missing content' }, { status: 400 })
    }

    // Verify ownership
    const existingMessage = await prisma.message.findUnique({ where: { id: messageId } })
    if (!existingMessage) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    if (existingMessage.sender_id !== senderId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const message = await prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        is_edited: true
      }
    })

    const serializedMessage = {
      ...message,
      id: message.id.toString(),
      organization_id: message.organization_id.toString(),
      sender_id: message.sender_id.toString(),
      receiver_id: message.receiver_id.toString(),
    }

    return NextResponse.json({ success: true, data: serializedMessage })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const senderId = BigInt(decoded.id)
    const messageId = BigInt(params.id)

    // Verify ownership
    const existingMessage = await prisma.message.findUnique({ where: { id: messageId } })
    if (!existingMessage) {
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 })
    }

    if (existingMessage.sender_id !== senderId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const message = await prisma.message.update({
      where: { id: messageId },
      data: {
        is_deleted: true,
        deleted_at: new Date()
      }
    })

    return NextResponse.json({ success: true, message: 'Message deleted successfully' })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
