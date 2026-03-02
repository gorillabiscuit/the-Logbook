/**
 * GET /api/admin/sensitivity-rules
 * Lists all sensitivity rules (category → tier mappings). Admin only.
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
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const { data, error } = await supabase
    .from('sensitivity_rules')
    .select(`
      id,
      category_id,
      sensitivity_tier,
      created_at,
      updated_at,
      category:categories(id, name, parent_id)
    `)
    .order('created_at')

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data ?? []
})
