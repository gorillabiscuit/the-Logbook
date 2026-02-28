/**
 * PATCH /api/issues/:id
 * Updates an issue. Creator or admin only.
 */
export default defineEventHandler(async (event) => {
  const issueId = getRouterParam(event, 'id')
  if (!issueId) throw createError({ statusCode: 400, statusMessage: 'Issue ID required' })

  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Check ownership or admin
  const { data: issue } = await supabase.from('issues').select('created_by').eq('id', issueId).single()
  if (!issue) throw createError({ statusCode: 404, statusMessage: 'Issue not found' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role && ['super_admin', 'trustee'].includes(profile.role)
  if (issue.created_by !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const updates: Record<string, any> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) {
    updates.status = body.status
    if (body.status === 'resolved' || body.status === 'closed') {
      updates.resolved_at = new Date().toISOString()
    }
  }
  if (body.severity !== undefined) updates.severity = body.severity
  if (body.category_id !== undefined) updates.category_id = body.category_id

  const { error } = await supabase.from('issues').update(updates).eq('id', issueId)
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
