/**
 * DELETE /api/notices/:id
 * Deletes a notice. Restricted to trustees and super_admin.
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

  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const { error } = await supabase.from('notices').delete().eq('id', noticeId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
