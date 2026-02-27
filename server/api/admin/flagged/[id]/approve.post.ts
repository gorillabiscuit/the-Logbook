/**
 * POST /api/admin/flagged/:id/approve
 * Approves or adjusts the categories for a flagged document, then unflags it.
 * Body: { categoryIds: string[] } — the final approved category IDs.
 */
export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'id')
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID required' })
  }

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

  // Parse request body
  const body = await readBody(event)
  const categoryIds: string[] = body?.categoryIds ?? []

  // Verify document exists and is flagged
  const { data: doc } = await supabase
    .from('documents')
    .select('id, processing_status')
    .eq('id', documentId)
    .single()

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (doc.processing_status !== 'flagged_for_review') {
    throw createError({ statusCode: 400, statusMessage: 'Document is not flagged for review' })
  }

  // Replace document categories with approved ones
  await supabase.from('document_categories').delete().eq('document_id', documentId)

  if (categoryIds.length > 0) {
    await supabase.from('document_categories').insert(
      categoryIds.map(catId => ({
        document_id: documentId,
        category_id: catId,
        confidence: 1.0, // Human-approved = 100% confidence
      }))
    )
  }

  // Unflag the document
  await supabase
    .from('documents')
    .update({
      processing_status: 'completed',
      ai_confidence: 1.0, // Override confidence since human-approved
    })
    .eq('id', documentId)

  return { success: true, documentId }
})
