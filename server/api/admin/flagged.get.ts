/**
 * GET /api/admin/flagged
 * Lists documents flagged for review (low AI confidence categorization).
 * Admin-only endpoint.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Verify caller is an admin
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: { user } } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['super_admin', 'trustee'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Admin access required' })
  }

  // Fetch flagged documents with their AI-suggested categories
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, title, original_filename, privacy_level, doc_type, ai_summary, ai_confidence, created_at')
    .eq('processing_status', 'flagged_for_review')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  // Fetch categories for each flagged document
  const docsWithCategories = await Promise.all(
    (docs ?? []).map(async (doc) => {
      const { data: cats } = await supabase
        .from('document_categories')
        .select(`
          confidence,
          category:categories(id, name)
        `)
        .eq('document_id', doc.id)

      return {
        ...doc,
        suggestedCategories: cats ?? [],
      }
    })
  )

  return docsWithCategories
})
