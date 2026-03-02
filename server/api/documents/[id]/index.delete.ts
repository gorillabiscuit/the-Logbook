/**
 * DELETE /api/documents/:id
 * Permanently delete a document and all associated data.
 * Admins/trustees can delete any document; owners can delete their own uploads.
 */
export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'id')
  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID required' })
  }

  const supabase = useSupabaseAdmin()

  // Authenticate caller
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

  if (!profile) {
    throw createError({ statusCode: 403, statusMessage: 'Profile not found' })
  }

  const isAdmin = ['super_admin', 'trustee'].includes(profile.role)

  // Fetch document to get file_url and uploaded_by before deletion
  const { data: doc } = await supabase
    .from('documents')
    .select('id, file_url, uploaded_by, canonical_document_id, dedup_status')
    .eq('id', documentId)
    .single()

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  // Authorization: admins can delete any doc, owners can delete their own
  if (!isAdmin && doc.uploaded_by !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can only delete documents you uploaded' })
  }

  // Handle canonical document deletion — promote oldest duplicate
  if (!doc.canonical_document_id) {
    // This might be a canonical doc — check for copies
    const { data: copies } = await supabase
      .from('documents')
      .select('id')
      .eq('canonical_document_id', documentId)
      .order('created_at', { ascending: true })

    if (copies && copies.length > 0) {
      const newCanonicalId = copies[0].id

      // Promote the oldest duplicate to canonical
      await supabase
        .from('documents')
        .update({
          canonical_document_id: null,
          dedup_status: 'unique',
        })
        .eq('id', newCanonicalId)

      // Re-link remaining copies to the new canonical
      if (copies.length > 1) {
        const otherCopyIds = copies.slice(1).map((c: any) => c.id)
        await supabase
          .from('documents')
          .update({ canonical_document_id: newCanonicalId })
          .in('id', otherCopyIds)
      }
    }
  }

  // 1. Remove from Meilisearch index
  try {
    await removeDocumentFromIndex(documentId)
  } catch (err) {
    console.warn(`Failed to remove document ${documentId} from Meilisearch:`, err)
  }

  // 2. Delete file from Supabase Storage
  if (doc.file_url) {
    const { error: storageError } = await supabase.storage
      .from('documents')
      .remove([doc.file_url])

    if (storageError) {
      console.warn(`Failed to delete storage file for document ${documentId}:`, storageError)
    }
  }

  // 3. Null out non-cascading FK references
  await supabase
    .from('timeline_events')
    .update({ source_document_id: null })
    .eq('source_document_id', documentId)

  await supabase
    .from('entities')
    .update({ discovered_from_document_id: null })
    .eq('discovered_from_document_id', documentId)

  // 4. Delete the document row (cascades: chunks, document_categories, issue_documents, entity_mentions, processing_log)
  const { error: deleteError } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (deleteError) {
    throw createError({ statusCode: 500, statusMessage: `Failed to delete document: ${deleteError.message}` })
  }

  return { deleted: true, documentId }
})
