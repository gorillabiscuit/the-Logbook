/**
 * POST /api/webhooks/email
 * Email ingestion webhook — receives inbound emails from Postmark/Cloudflare.
 * Extracts sender, body, and attachments. Creates document records and triggers processing.
 *
 * Expected payload (Postmark Inbound format):
 * {
 *   From: "sender@example.com",
 *   FromName: "Sender Name",
 *   To: "share@logbook.yachtclub.co.za",
 *   Subject: "Document title",
 *   TextBody: "Email body text",
 *   HtmlBody: "<p>Email body</p>",
 *   Attachments: [{ Name, ContentType, ContentLength, Content (base64) }]
 * }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const supabase = useSupabaseAdmin()

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
  const attachments: Array<{ Name: string; ContentType: string; Content: string; ContentLength: number }> =
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

  const createdDocuments: string[] = []

  // Process attachments as documents
  if (attachments.length > 0) {
    for (const attachment of attachments) {
      try {
        const buffer = Buffer.from(attachment.Content, 'base64')
        const ext = attachment.Name.split('.').pop() || 'bin'
        const storagePath = `email/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

        // Upload to Supabase Storage
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

        // Create document record
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
            source_channel: privacyLevel === 'private' ? 'email_private' : 'email_shared',
            processing_status: 'pending',
          })
          .select('id')
          .single()

        if (dbError) {
          console.error(`Failed to create document record for ${attachment.Name}:`, dbError)
          continue
        }

        if (doc) {
          createdDocuments.push(doc.id)
          // Fire-and-forget processing
          processDocument(doc.id).catch(err => {
            console.error(`Pipeline failed for email attachment ${doc.id}:`, err)
          })
        }
      } catch (err) {
        console.error(`Error processing attachment ${attachment.Name}:`, err)
      }
    }
  }

  // If no attachments, store the email body as a document
  if (attachments.length === 0 && textBody.trim()) {
    const emailContent = `From: ${senderName} <${senderEmail}>\nSubject: ${subject}\n\n${textBody}`
    const buffer = Buffer.from(emailContent, 'utf-8')
    const storagePath = `email/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`

    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: 'text/plain',
        upsert: false,
      })

    if (!storageError) {
      const { data: doc } = await supabase
        .from('documents')
        .insert({
          uploaded_by: uploadedBy,
          title: subject,
          original_filename: `${subject}.txt`,
          file_url: storagePath,
          file_size_bytes: buffer.length,
          mime_type: 'text/plain',
          privacy_level: privacyLevel,
          source_channel: privacyLevel === 'private' ? 'email_private' : 'email_shared',
          processing_status: 'pending',
        })
        .select('id')
        .single()

      if (doc) {
        createdDocuments.push(doc.id)
        processDocument(doc.id).catch(err => {
          console.error(`Pipeline failed for email body document ${doc.id}:`, err)
        })
      }
    }
  }

  return {
    success: true,
    documentsCreated: createdDocuments.length,
    documentIds: createdDocuments,
    sender: senderEmail,
    privacyLevel,
    matched: !!uploadedBy,
  }
})
