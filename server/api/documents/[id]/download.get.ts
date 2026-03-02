/**
 * GET /api/documents/:id/download
 * Generates a signed URL for downloading the document from Supabase Storage.
 * The signed URL expires after 1 hour.
 *
 * Download access uses sensitivity tiers:
 * - Submitter: always allowed (own document)
 * - super_admin/trustee/lawyer: always allowed
 * - scheme_ops: owner + building_manager allowed
 * - personal_financial: only privileged roles + submitter
 * - privileged_legal: only privileged roles + submitter
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const documentId = getRouterParam(event, 'id')

  if (!documentId) {
    throw createError({ statusCode: 400, statusMessage: 'Document ID is required' })
  }

  // Auth check
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Fetch document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('file_url, original_filename, uploaded_by, privacy_level, sensitivity_tier')
    .eq('id', documentId)
    .single()

  if (docError || !doc) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  if (!doc.file_url) {
    throw createError({ statusCode: 404, statusMessage: 'No file associated with this document' })
  }

  // Fetch user role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const userRole = profile?.role ?? ''
  const isSubmitter = doc.uploaded_by === user.id
  const tier = doc.sensitivity_tier ?? 'scheme_ops'

  // Submitter can always download their own documents
  if (isSubmitter) {
    return await generateSignedUrl(supabase, doc)
  }

  // Privileged roles can always download
  if (['super_admin', 'trustee', 'lawyer'].includes(userRole)) {
    return await generateSignedUrl(supabase, doc)
  }

  // Tier-specific checks for non-privileged, non-submitter users
  if (tier === 'scheme_ops') {
    if (['owner', 'building_manager'].includes(userRole)) {
      return await generateSignedUrl(supabase, doc)
    }
  }

  // personal_financial and privileged_legal: only privileged roles (handled above)
  // If we reach here, access is denied
  const messages: Record<string, string> = {
    personal_financial: 'This document contains personal financial information and cannot be downloaded per POPIA requirements.',
    privileged_legal: 'This is a privileged legal document. Only trustees and lawyers can access it.',
    scheme_ops: 'You do not have permission to download this document.',
  }

  throw createError({
    statusCode: 403,
    statusMessage: messages[tier] ?? messages.scheme_ops,
  })
})

async function generateSignedUrl(
  supabase: ReturnType<typeof useSupabaseAdmin>,
  doc: { file_url: string; original_filename: string | null }
) {
  const { data: signedData, error: signedError } = await supabase.storage
    .from('documents')
    .createSignedUrl(doc.file_url, 3600, {
      download: doc.original_filename || undefined,
    })

  if (signedError || !signedData?.signedUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to generate download URL: ${signedError?.message ?? 'Unknown error'}`,
    })
  }

  return { url: signedData.signedUrl }
}
