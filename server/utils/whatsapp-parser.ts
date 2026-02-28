/**
 * WhatsApp chat export parser.
 * Parses exported .txt files from WhatsApp into structured messages.
 *
 * WhatsApp export format (varies by locale/OS):
 *   [2024/01/15, 14:30:22] John Doe: Message text here
 *   15/01/2024, 14:30 - John Doe: Message text here
 *   1/15/24, 2:30 PM - John Doe: Message text here
 */

export interface WhatsAppMessage {
  timestamp: string // ISO string
  sender: string
  content: string
  isMedia: boolean
}

export interface WhatsAppParseResult {
  messages: WhatsAppMessage[]
  participants: string[]
  startDate: string | null
  endDate: string | null
  messageCount: number
}

// Multiple regex patterns for different WhatsApp export formats
const MESSAGE_PATTERNS = [
  // [YYYY/MM/DD, HH:mm:ss] Sender: Message
  /^\[(\d{4}\/\d{1,2}\/\d{1,2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*(.+)$/,
  // DD/MM/YYYY, HH:mm - Sender: Message
  /^(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+?):\s*(.+)$/,
  // M/D/YY, H:mm AM/PM - Sender: Message
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?:\s*[APap][Mm])?)\s*-\s*(.+?):\s*(.+)$/,
]

// System message patterns (no sender)
const SYSTEM_PATTERNS = [
  /^\[(\d{4}\/\d{1,2}\/\d{1,2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/,
  /^(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+)$/,
]

const MEDIA_INDICATORS = [
  '<Media omitted>',
  'image omitted',
  'video omitted',
  'audio omitted',
  'sticker omitted',
  'document omitted',
  'GIF omitted',
  'Contact card omitted',
]

function parseDate(datePart: string, timePart: string): string {
  // Try YYYY/MM/DD
  let match = datePart.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (match) {
    const [, year, month, day] = match
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart.replace(/\s*[APap][Mm]/, '')}`).toISOString()
  }

  // Try DD/MM/YYYY
  match = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    const [, day, month, year] = match
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart.replace(/\s*[APap][Mm]/, '')}`).toISOString()
  }

  // Try M/D/YY or M/D/YYYY
  match = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (match) {
    let [, month, day, year] = match
    if (year.length === 2) year = `20${year}`
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart.replace(/\s*[APap][Mm]/, '')}`).toISOString()
  }

  return new Date().toISOString()
}

export function parseWhatsAppExport(text: string): WhatsAppParseResult {
  const lines = text.split('\n')
  const messages: WhatsAppMessage[] = []
  const participantSet = new Set<string>()
  let currentMessage: WhatsAppMessage | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let matched = false

    // Try each message pattern
    for (const pattern of MESSAGE_PATTERNS) {
      const match = trimmed.match(pattern)
      if (match) {
        // Save previous message
        if (currentMessage) {
          messages.push(currentMessage)
        }

        const [, datePart, timePart, sender, content] = match
        const isMedia = MEDIA_INDICATORS.some(indicator =>
          content.toLowerCase().includes(indicator.toLowerCase())
        )

        participantSet.add(sender.trim())
        currentMessage = {
          timestamp: parseDate(datePart, timePart),
          sender: sender.trim(),
          content: content.trim(),
          isMedia,
        }
        matched = true
        break
      }
    }

    // Skip system messages
    if (!matched) {
      for (const pattern of SYSTEM_PATTERNS) {
        if (trimmed.match(pattern)) {
          matched = true
          break
        }
      }
    }

    // Continuation of previous message (multi-line)
    if (!matched && currentMessage) {
      currentMessage.content += '\n' + trimmed
    }
  }

  // Push last message
  if (currentMessage) {
    messages.push(currentMessage)
  }

  const participants = Array.from(participantSet).sort()
  const timestamps = messages.map(m => m.timestamp).filter(Boolean)

  return {
    messages,
    participants,
    startDate: timestamps.length > 0 ? timestamps[0] : null,
    endDate: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
    messageCount: messages.length,
  }
}

/**
 * Convert parsed WhatsApp messages into a readable document text.
 */
export function whatsAppToDocument(result: WhatsAppParseResult): string {
  const lines: string[] = [
    `WhatsApp Chat Export`,
    `Participants: ${result.participants.join(', ')}`,
    `Period: ${result.startDate ? new Date(result.startDate).toLocaleDateString('en-ZA') : 'unknown'} — ${result.endDate ? new Date(result.endDate).toLocaleDateString('en-ZA') : 'unknown'}`,
    `Messages: ${result.messageCount}`,
    '',
    '---',
    '',
  ]

  for (const msg of result.messages) {
    if (msg.isMedia) continue // Skip media-omitted messages
    const date = new Date(msg.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })
    lines.push(`[${date}] ${msg.sender}: ${msg.content}`)
  }

  return lines.join('\n')
}
