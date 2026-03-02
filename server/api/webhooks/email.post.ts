/**
 * POST /api/webhooks/email
 * Email ingestion webhook — receives inbound emails from Postmark/Cloudflare.
 * Extracts sender, body, and attachments. Creates document records and triggers processing.
 *
 * Features:
 * - Smart attachment filtering (skips logos, tracking pixels, .ics, .vcf, winmail.dat)
 * - AI body triage (when attachments exist, decides if body is worth storing separately)
 * - Email context metadata stored on each document for provenance
 *
 * Expected payload (Postmark Inbound format):
 * {
 *   From: "sender@example.com",
 *   FromName: "Sender Name",
 *   To: "share@logbook.yachtclub.co.za",
 *   Subject: "Document title",
 *   TextBody: "Email body text",
 *   HtmlBody: "<p>Email body</p>",
 *   Attachments: [{ Name, ContentType, ContentLength, Content (base64), ContentID }]
 * }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const supabase = useSupabaseAdmin()
  const processingPromises: Promise<void>[] = []

  // Verify webhook secret
  const webhookSecret = config.emailWebhookSecret
  if (webhookSecret) {
    const authHeader = getHeader(event, 'x-webhook-secret') || getHeader(event, 'authorization')
    if (authHeader !== webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid webhook secret' })
    }
  }

  const body = await readBody(event)

  const senderEmail = body.From || body.from || ''
  const senderName = body.FromName || body.fromName || ''
  const toAddress = (body.To || body.to || '').toLowerCase()
  const subject = body.Subject || body.subject || 'Email document'
  const textBody = body.TextBody || body.textBody || body.text || ''
  const attachments: Array<{ Name: string; ContentType: string; Content: string; ContentLength: number; ContentID?: string }> =
    body.Attachments || body.attachments || []

  // Determine privacy level based on recipient address
  let privacyLevel = 'shared'
  if (toAddress.includes('private')) {
    privacyLevel = 'private'
  }

  // Match sender to a user profile
  let uploadedBy: string | null = null
  if (senderEmail) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('email', senderEmail.toLowerCase().trim())
      .single()

    if (profile?.is_active) {
      uploadedBy = profile.id
    }
  }

  const sourceChannel = privacyLevel === 'private' ? 'email_private' : 'email_shared'
  const receivedAt = new Date().toISOString()
  const createdDocuments: string[] = []

  // Filter attachments — skip junk (logos, tracking pixels, .ics, .vcf, etc.)
  const validAttachments = attachments.filter(shouldProcessAttachment)
  const attachmentsFiltered = attachments.length - validAttachments.length

  // Build email context object for provenance
  const emailContext = {
    sender_email: senderEmail,
    sender_name: senderName,
    subject,
    body_snippet: textBody.trim().slice(0, 500) || null,
    received_at: receivedAt,
    body_stored_as_document: false,
    body_document_id: null as string | null,
  }

  // Helper: store email body text as a document
  const storeEmailBodyAsDocument = async (title: string, context: typeof emailContext) => {
    const emailContent = `From: ${senderName} <${senderEmail}>\nSubject: ${subject}\n\n${textBody}`
    const buffer = Buffer.from(emailContent, 'utf-8')
    const storagePath = `email/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`

    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: 'text/plain',
        upsert: false,
      })

    if (storageError) {
      console.error('Failed to store email body:', storageError)
      return null
    }

    const { data: doc } = await supabase
      .from('documents')
      .insert({
        uploaded_by: uploadedBy,
        title,
        original_filename: `${title}.txt`,
        file_url: storagePath,
        file_size_bytes: buffer.length,
        mime_type: 'text/plain',
        privacy_level: privacyLevel,
        source_channel: sourceChannel,
        processing_status: 'pending',
        email_context: context,
      })
      .select('id')
      .single()

    if (doc) {
      createdDocuments.push(doc.id)
      processingPromises.push(
        processDocument(doc.id).catch(err => {
          console.error(`Pipeline failed for email body document ${doc.id}:`, err)
        })
      )
    }

    return doc?.id ?? null
  }

  // Process valid attachments
  if (validAttachments.length > 0) {
    // Triage the body: should it be stored as its own document alongside attachments?
    if (textBody.trim()) {
      const triage = await triageEmailBody(textBody, subject)
      if (triage.isSubstantive) {
        const bodyDocId = await storeEmailBodyAsDocument(subject, {
          ...emailContext,
          body_stored_as_document: true,
        })
        if (bodyDocId) {
          emailContext.body_stored_as_document = true
          emailContext.body_document_id = bodyDocId
        }
      }
    }

    // Store each valid attachment as a document
    for (const attachment of validAttachments) {
      try {
        const buffer = Buffer.from(attachment.Content, 'base64')
        const ext = attachment.Name.split('.').pop() || 'bin'
        const storagePath = `email/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

        const { error: storageError } = await supabase.storage
          .from('documents')
          .upload(storagePath, buffer, {
            contentType: attachment.ContentType,
            upsert: false,
          })

        if (storageError) {
          console.error(`Failed to store attachment ${attachment.Name}:`, storageError)
          continue
        }

        const { data: doc, error: dbError } = await supabase
          .from('documents')
          .insert({
            uploaded_by: uploadedBy,
            title: attachment.Name.replace(/\.[^.]+$/, ''),
            original_filename: attachment.Name,
            file_url: storagePath,
            file_size_bytes: attachment.ContentLength || buffer.length,
            mime_type: attachment.ContentType,
            privacy_level: privacyLevel,
            source_channel: sourceChannel,
            processing_status: 'pending',
            email_context: emailContext,
          })
          .select('id')
          .single()

        if (dbError) {
          console.error(`Failed to create document record for ${attachment.Name}:`, dbError)
          continue
        }

        if (doc) {
          createdDocuments.push(doc.id)
          processingPromises.push(
            processDocument(doc.id).catch(err => {
              console.error(`Pipeline failed for email attachment ${doc.id}:`, err)
            })
          )
        }
      } catch (err) {
        console.error(`Error processing attachment ${attachment.Name}:`, err)
      }
    }
  }

  // If NO valid attachments, store the email body as a document (existing fallback)
  if (validAttachments.length === 0 && textBody.trim()) {
    await storeEmailBodyAsDocument(subject, {
      ...emailContext,
      body_stored_as_document: true,
    })
  }

  // Use waitUntil to keep the function alive on Vercel while processing runs
  if (processingPromises.length > 0) {
    const allProcessing = Promise.all(processingPromises)
    if (typeof (event as any).waitUntil === 'function') {
      ;(event as any).waitUntil(allProcessing)
    }
  }

  return {
    success: true,
    documentsCreated: createdDocuments.length,
    documentIds: createdDocuments,
    attachmentsFiltered,
    sender: senderEmail,
    privacyLevel,
    matched: !!uploadedBy,
  }
})
