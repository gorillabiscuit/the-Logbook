/**
 * DELETE /api/admin/categories/:id
 * Delete a category (only if no documents are linked). Admin only.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const categoryId = getRouterParam(event, 'id')

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Check if category has linked documents
  const { count } = await supabase
    .from('document_categories')
    .select('document_id', { count: 'exact', head: true })
    .eq('category_id', categoryId)

  if (count && count > 0) {
    throw createError({ statusCode: 409, statusMessage: `Cannot delete: ${count} document(s) are linked to this category` })
  }

  // Check if category has children
  const { count: childCount } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', categoryId)

  if (childCount && childCount > 0) {
    throw createError({ statusCode: 409, statusMessage: `Cannot delete: category has ${childCount} sub-categories` })
  }

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
