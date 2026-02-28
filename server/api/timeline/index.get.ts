/**
 * GET /api/timeline
 * Lists timeline events, most recent first. Privacy-scoped.
 * Optional filters: event_type, year.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const query = getQuery(event)

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()

  let q = supabase
    .from('timeline_events')
    .select('id, event_date, title, description, event_type, privacy_level, is_auto_generated, created_at, source_document_id, issue_id, documents:source_document_id(id, title)')
    .order('event_date', { ascending: false })

  // Privacy filtering
  const isPrivileged = profile?.role && ['super_admin', 'trustee', 'lawyer'].includes(profile.role)
  if (!isPrivileged) {
    q = q.eq('privacy_level', 'shared')
  }

  if (query.event_type) q = q.eq('event_type', query.event_type as string)
  if (query.year) {
    q = q.gte('event_date', `${query.year}-01-01`).lte('event_date', `${query.year}-12-31`)
  }

  const { data, error } = await q.limit(200)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data ?? []
})
