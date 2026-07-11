import { NextRequest, NextResponse } from 'next/server'
import { friendlyMessage } from '@/lib/api-error'
import { writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

// Stores uploads on the server's local filesystem under public/uploads/<kind>/
// and returns a URL Next.js already serves statically. This works as-is for
// this dev environment and for any traditional (non-serverless) deployment
// with a persistent disk. It will NOT persist on serverless platforms
// (Vercel, etc.) - those need real object storage (S3/Supabase Storage)
// instead, swapped in behind this same route.
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

const KIND_TO_SUBDIR: Record<string, string> = {
  receipt: 'receipts',
  avatar: 'avatars',
}

// No auth check here: this is used both by logged-in Settings pages and by
// the registration -> subscription flow, where the user has no session
// token yet. Unlike /api/subscriptions/subscribe (which now requires a flow
// token or session, since it mutates a specific organization's billing
// state), this route only writes an anonymous file to disk and returns an
// unguessable filename - it doesn't read or mutate anything tied to a
// specific user/org, so type/size validation below is sufficient here.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const kind = (formData.get('kind') as string) || 'misc'

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Missing file' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Only PDF, PNG, JPG, or WEBP files are allowed' },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: 'File must be 10MB or smaller' }, { status: 400 })
    }

    const subdir = KIND_TO_SUBDIR[kind] || 'misc'
    const ext = path.extname(file.name) || (file.type === 'application/pdf' ? '.pdf' : '.jpg')
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', subdir)
    const filePath = path.join(uploadDir, filename)

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    const url = `/uploads/${subdir}/${filename}`

    return NextResponse.json({ success: true, data: { url } }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: friendlyMessage(error) }, { status: 500 })
  }
}
