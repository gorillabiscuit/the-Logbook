/**
 * PATCH /api/admin/entities/:id
 * Confirm or update an entity. Admin only.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const entityId = getRouterParam(event, 'id')

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }

  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.entity_type) updates.entity_type = body.entity_type
  if (typeof body.is_confirmed === 'boolean') updates.is_confirmed = body.is_confirmed
  if (body.properties) updates.properties = body.properties

  const { data, error } = await supabase
    .from('entities')
    .update(updates)
    .eq('id', entityId)
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
