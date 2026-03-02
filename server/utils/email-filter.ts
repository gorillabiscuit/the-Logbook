/**
 * Pure function to filter junk email attachments.
 * Rejects signature logos, tracking pixels, calendar invites, vCards, and winmail.dat.
 * Defaults to keeping unknown types (safer to over-include).
 */

interface EmailAttachment {
  Name: string
  ContentType: string
  Content: string
  ContentLength: number
  ContentID?: string
}

const REJECTED_MIME_TYPES = new Set([
  'text/calendar',
  'text/x-vcard',
  'application/ms-tnef',
])

const REJECTED_EXTENSIONS = new Set([
  '.vcf',
  '.ics',
  '.dat',
])

const IMAGE_MIME_PREFIX = 'image/'

/** Minimum size (bytes) for standalone images to be kept */
const MIN_IMAGE_SIZE = 10 * 1024 // 10KB

/** Minimum size (bytes) for inline images (with ContentID) to be kept */
const MIN_INLINE_IMAGE_SIZE = 100 * 1024 // 100KB

/**
 * Determines whether an email attachment should be processed as a document.
 * Returns `true` if the attachment is worth keeping, `false` if it's junk.
 */
export function shouldProcessAttachment(attachment: EmailAttachment): boolean {
  const mimeType = (attachment.ContentType || '').toLowerCase()
  const name = attachment.Name || ''
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  const size = attachment.ContentLength || 0

  // Reject known junk MIME types
  if (REJECTED_MIME_TYPES.has(mimeType)) {
    return false
  }

  // Reject known junk extensions
  if (REJECTED_EXTENSIONS.has(ext)) {
    return false
  }

  // Filter small images (logos, tracking pixels, signature images)
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) {
    const isInline = !!attachment.ContentID
    const minSize = isInline ? MIN_INLINE_IMAGE_SIZE : MIN_IMAGE_SIZE
    if (size < minSize) {
      return false
    }
  }

  // Keep everything else (PDFs, Word, Excel, PowerPoint, .txt, .csv, .eml, .msg, unknown types)
  return true
}
