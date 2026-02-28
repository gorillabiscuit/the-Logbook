/**
 * POST /api/timeline
 * Creates a timeline event. Admin only.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Only trustees can create timeline events' })
  }

  const body = await readBody(event)
  if (!body?.title?.trim() || !body?.event_date) {
    throw createError({ statusCode: 400, statusMessage: 'Title and event_date are required' })
  }

  const { data, error } = await supabase
    .from('timeline_events')
    .insert({
      event_date: body.event_date,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      event_type: body.event_type || null,
      source_document_id: body.source_document_id || null,
      issue_id: body.issue_id || null,
      privacy_level: body.privacy_level || 'shared',
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
