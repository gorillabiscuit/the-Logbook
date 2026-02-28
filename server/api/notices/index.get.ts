/**
 * GET /api/notices
 * Lists notices, pinned first, then by date. Hides expired notices.
 */
export default defineEventHandler(async () => {
  const supabase = useSupabaseAdmin()

  const { data, error } = await supabase
    .from('notices')
    .select('id, title, content, notice_type, is_pinned, expires_at, created_at, published_by, profiles:published_by(full_name)')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data ?? []
})
