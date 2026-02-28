/**
 * GET /api/admin/categories
 * Lists all categories with document counts. Admin only.
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

  const [categoriesResult, countsResult] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, parent_id, description, is_auto_created, created_at')
      .order('name'),
    supabase
      .from('document_categories')
      .select('category_id'),
  ])

  const categories = categoriesResult.data ?? []

  // Count documents per category
  const docCounts: Record<string, number> = {}
  for (const dc of countsResult.data ?? []) {
    docCounts[dc.category_id] = (docCounts[dc.category_id] || 0) + 1
  }

  return categories.map(c => ({
    ...c,
    documentCount: docCounts[c.id] || 0,
  }))
})
