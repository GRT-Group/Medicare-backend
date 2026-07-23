import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { prisma } from '@/lib/prisma'
import { getBearerToken, verifyBearerToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers)
    if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    
    let decoded
    try {
      decoded = verifyBearerToken(req.headers)
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'Organization ID missing' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const otherUserIdParam = searchParams.get('otherUserId')
    const currentUserId = BigInt(decoded.id)

    let whereClause: any = {
      organization_id: organizationId,
      is_deleted: false,
    }

    if (otherUserIdParam) {
      const otherUserId = BigInt(otherUserIdParam)
      whereClause.OR = [
        { sender_id: currentUserId, receiver_id: otherUserId },
        { sender_id: otherUserId, receiver_id: currentUserId }
      ]
    }

    const messages = await prisma.message.findMany({
      where: whereClause,
      orderBy: { created_at: 'asc' },
      include: {
        Sender: { select: { id: true, first_name: true, last_name: true, is_online: true, last_active_at: true } },
        Receiver: { select: { id: true, first_name: true, last_name: true } }
      }
    })

    const serializedMessages = messages.map(m => ({
      ...m,
      id: m.id.toString(),
      organization_id: m.organization_id.toString(),
      sender_id: m.sender_id.toString(),
      receiver_id: m.receiver_id.toString(),
      Sender: m.Sender ? { ...m.Sender, id: m.Sender.id.toString() } : null,
      Receiver: m.Receiver ? { ...m.Receiver, id: m.Receiver.id.toString() } : null,
    }))

    return NextResponse.json({ success: true, data: serializedMessages })
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
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const organizationId = decoded.organization_id ? BigInt(decoded.organization_id) : undefined
    if (!organizationId) {
      return NextResponse.json({ success: false, error: 'Organization ID missing' }, { status: 400 })
    }

    const senderId = BigInt(decoded.id)
    const body = await req.json()
    const { receiverId, content } = body

    if (!receiverId || !content) {
      return NextResponse.json({ success: false, error: 'Missing receiverId or content' }, { status: 400 })
    }

    const message = await prisma.message.create({
      data: {
        organization_id: organizationId,
        sender_id: senderId,
        receiver_id: BigInt(receiverId),
        content,
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
