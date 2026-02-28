/**
 * PATCH /api/notices/:id
 * Updates a notice. Restricted to trustees, super_admin, building_manager, management_co.
 */
export default defineEventHandler(async (event) => {
  const noticeId = getRouterParam(event, 'id')
  if (!noticeId) throw createError({ statusCode: 400, statusMessage: 'Notice ID required' })

  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const allowed = ['super_admin', 'trustee', 'building_manager', 'management_co']
  if (!profile || !allowed.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const updates: Record<string, any> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.content !== undefined) updates.content = body.content
  if (body.notice_type !== undefined) updates.notice_type = body.notice_type
  if (body.is_pinned !== undefined) updates.is_pinned = body.is_pinned
  if (body.expires_at !== undefined) updates.expires_at = body.expires_at

  const { error } = await supabase
    .from('notices')
    .update(updates)
    .eq('id', noticeId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
