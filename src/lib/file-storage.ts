import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js'

/**
 * Single place every "generate/upload a file, get back a URL" flow in this
 * codebase should go through (organization logos, generated PDF invoices,
 * receipts, etc). Tries Supabase Storage first (works across serverless
 * deployments); if Supabase isn't configured or the upload call itself fails
 * (e.g. a malformed SUPABASE_SERVICE_ROLE_KEY), falls back to writing the
 * file to public/uploads/<bucket>/ on local disk so the feature still works
 * in dev / single-instance deployments instead of hard-failing the caller.
 */
export async function storeFile(
  bucket: string,
  filename: string,
  bytes: Buffer,
  contentType: string
): Promise<{ url: string; provider: 'supabase' | 'local' }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createSupabaseAdminClient(supabaseUrl, supabaseKey)
      const { error } = await supabase.storage
        .from(bucket)
        .upload(filename, bytes, { contentType, upsert: true })

      if (!error) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
        return { url: data.publicUrl, provider: 'supabase' }
      }
      console.error(`[FILE STORAGE] Supabase upload failed for ${bucket}/${filename}, falling back to local disk:`, error.message)
    } catch (err) {
      console.error(`[FILE STORAGE] Supabase client error for ${bucket}/${filename}, falling back to local disk:`, err)
    }
  }

  // filename may itself contain slashes (e.g. "4/logo-123.png") to namespace
  // by organization, so ensure the full nested directory exists, not just
  // the bucket-level one.
  const destination = path.join(process.cwd(), 'public', 'uploads', bucket, filename)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  return { url: `/uploads/${bucket}/${filename}`, provider: 'local' }
}
