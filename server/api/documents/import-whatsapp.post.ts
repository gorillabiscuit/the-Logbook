/**
 * POST /api/documents/import-whatsapp
 * Imports a WhatsApp chat export (.txt).
 * Parses messages, creates a document with the conversation text,
 * and triggers processing pipeline.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const { content, title, privacy_level } = body

  if (!content || typeof content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'WhatsApp export text content is required' })
  }

  // Parse the WhatsApp export
  const parsed = parseWhatsAppExport(content)
  if (parsed.messageCount === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No messages found in the export' })
  }

  // Convert to a readable document
  const documentText = whatsAppToDocument(parsed)
  const buffer = Buffer.from(documentText, 'utf-8')

  const docTitle = title || `WhatsApp: ${parsed.participants.slice(0, 3).join(', ')}${parsed.participants.length > 3 ? '...' : ''}`
  const storagePath = `whatsapp/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`

  // Upload to storage
  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, buffer, {
      contentType: 'text/plain',
      upsert: false,
    })

  if (storageError) {
    throw createError({ statusCode: 500, statusMessage: `Storage error: ${storageError.message}` })
  }

  // Create document record
  const { data: doc, error: dbError } = await supabase
    .from('documents')
    .insert({
      uploaded_by: user.id,
      title: docTitle,
      original_filename: `${docTitle}.txt`,
      file_url: storagePath,
      file_size_bytes: buffer.length,
      mime_type: 'text/plain',
      privacy_level: privacy_level || 'shared',
      doc_type: 'email',
      doc_date: parsed.startDate ? parsed.startDate.split('T')[0] : null,
      source_channel: 'web_upload',
      processing_status: 'pending',
      extracted_text: documentText, // Pre-fill extracted text — skip extraction stage
    })
    .select('id')
    .single()

  if (dbError) {
    throw createError({ statusCode: 500, statusMessage: dbError.message })
  }

  // Fire-and-forget processing (will skip extraction since text is pre-filled)
  processDocument(doc.id).catch(err => {
    console.error(`Pipeline failed for WhatsApp import ${doc.id}:`, err)
  })

  return {
    documentId: doc.id,
    title: docTitle,
    participants: parsed.participants,
    messageCount: parsed.messageCount,
    dateRange: {
      start: parsed.startDate,
      end: parsed.endDate,
    },
  }
})
