/**
 * POST /api/documents/:id/confirm-share
 * Sender confirms whether an email-to-share@ document may be published as shared.
 * Body: { action: 'publish_shared' | 'keep_private' }
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const documentId = event.context.params?.id
  if (!documentId) throw createError({ statusCode: 400, statusMessage: 'Missing document id' })

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const action = body?.action
  if (action !== 'publish_shared' && action !== 'keep_private') {
    throw createError({ statusCode: 400, statusMessage: 'action must be publish_shared or keep_private' })
  }

  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, uploaded_by, share_publication_status, privacy_level')
    .eq('id', documentId)
    .single()

  if (fetchError || !doc) throw createError({ statusCode: 404, statusMessage: 'Document not found' })

  if (doc.uploaded_by !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Only the matched sender can confirm' })
  }

  if (doc.share_publication_status !== 'pending_sender_confirm') {
    throw createError({ statusCode: 400, statusMessage: 'Document is not awaiting your confirmation' })
  }

  if (action === 'keep_private') {
    await supabase
      .from('documents')
      .update({
        privacy_level: 'private',
        share_publication_status: 'sender_kept_private',
      })
      .eq('id', documentId)

    await reindexDocumentSearchRow(documentId)

    return { ok: true, share_publication_status: 'sender_kept_private' }
  }

  await supabase
    .from('documents')
    .update({
      privacy_level: 'shared',
      share_publication_status: 'sender_confirmed_shared',
    })
    .eq('id', documentId)

  await reindexDocumentSearchRow(documentId)

  return { ok: true, share_publication_status: 'sender_confirmed_shared' }
})
