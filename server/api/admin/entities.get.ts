/**
 * GET /api/admin/entities?type=&confirmed=
 * Lists knowledge graph entities. Admin only.
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
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  let q = supabase
    .from('entities')
    .select('id, entity_type, name, properties, is_confirmed, created_at, documents:discovered_from_document_id(id, title)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (query.type) {
    q = q.eq('entity_type', query.type as string)
  }
  if (query.confirmed === 'true') {
    q = q.eq('is_confirmed', true)
  } else if (query.confirmed === 'false') {
    q = q.eq('is_confirmed', false)
  }

  const { data, error } = await q

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data ?? []
})
