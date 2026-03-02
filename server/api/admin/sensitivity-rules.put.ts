/**
 * PUT /api/admin/sensitivity-rules
 * Upserts a sensitivity rule (category → tier mapping). Admin only.
 * Body: { category_id: string, sensitivity_tier: string }
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

  const body = await readBody(event)
  const { category_id, sensitivity_tier } = body

  if (!category_id || !sensitivity_tier) {
    throw createError({ statusCode: 400, statusMessage: 'category_id and sensitivity_tier are required' })
  }

  const validTiers = ['scheme_ops', 'personal_financial', 'privileged_legal']
  if (!validTiers.includes(sensitivity_tier)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid sensitivity_tier. Must be one of: ${validTiers.join(', ')}` })
  }

  const { data, error } = await supabase
    .from('sensitivity_rules')
    .upsert(
      {
        category_id,
        sensitivity_tier,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'category_id' }
    )
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
