/**
 * POST /api/notices
 * Creates a notice. Restricted to trustees, super_admin, building_manager, management_co.
 */
export default defineEventHandler(async (event) => {
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
    throw createError({ statusCode: 403, statusMessage: 'Only trustees and managers can publish notices' })
  }

  const body = await readBody(event)
  if (!body?.title?.trim() || !body?.content?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Title and content are required' })
  }

  const { data, error } = await supabase
    .from('notices')
    .insert({
      title: body.title.trim(),
      content: body.content.trim(),
      notice_type: body.notice_type || 'general',
      is_pinned: body.is_pinned || false,
      expires_at: body.expires_at || null,
      published_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
