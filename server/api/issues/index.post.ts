/**
 * POST /api/issues
 * Creates a new issue. Any authenticated user can create issues.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Title is required' })
  }

  const { data, error } = await supabase
    .from('issues')
    .insert({
      created_by: user.id,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      category_id: body.category_id || null,
      severity: body.severity || 'normal',
      privacy_level: body.privacy_level || 'shared',
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
