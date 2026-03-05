/**
 * PII detection and scrubbing using Claude API.
 * Supports two scrub levels:
 * - light: Redacts bank accounts, ID numbers, personal email/phone.
 *          Keeps owner names, unit numbers, levy amounts, voting records.
 * - heavy: Redacts all personal information including names, financial amounts,
 *          purchase prices, attorney details from personal transactions.
 */
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (_client) return _client
  const config = useRuntimeConfig()
  const apiKey = config.anthropicApiKey
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  _client = new Anthropic({ apiKey })
  return _client
}

const PII_HEAVY_PROMPT = `You are a PII redaction specialist for a South African residential body corporate platform.

Your task: Replace personally identifiable information with typed placeholders, while preserving context needed for building management.

REDACT these categories:
- Full names of individuals (residents, owners, purchasers, tenants, witnesses, signatories): [REDACTED_NAME]
- SA ID numbers (13-digit): [REDACTED_ID_NUMBER]
- Phone numbers (landline +27 or 0xx, mobile): [REDACTED_PHONE]
- Email addresses: [REDACTED_EMAIL]
- Physical/postal addresses (when identifying a person's residence, NOT the building itself): [REDACTED_ADDRESS]
- Bank account numbers: [REDACTED_BANK_ACCOUNT]
- Financial amounts tied to specific individuals: [REDACTED_AMOUNT]
- Signatures and handwritten annotations: [REDACTED_SIGNATURE]
- Purchase prices, sale amounts, bond amounts: [REDACTED_AMOUNT]
- Buyer/seller names: [REDACTED_NAME]
- Attorney details from personal transactions: [REDACTED_ATTORNEY]
- Personal financial figures (individual levy arrears, personal bond details): [REDACTED_AMOUNT]

PRESERVE (do not redact):
- The building name "The Yacht Club" or its address
- Company names (AMDEC, management companies, contractor businesses)
- Names of contractors and service providers (plumbers, electricians, etc.)
- Unit numbers (these are building references, not personal addresses)
- Dates, meeting references, resolution numbers
- General financial figures (levy amounts, budgets) that aren't tied to one person's private finances
- Role titles themselves (e.g. "the chairman", "the trustee", "the building manager") — but REDACT the person's name even if their role is mentioned alongside it (e.g. "John Smith, Chairman" → "[REDACTED_NAME], Chairman")
- Document type and document date

RULES:
- Return ONLY the redacted text, nothing else
- Preserve all formatting (paragraphs, bullet points, line breaks)
- When in doubt, redact — it's safer to over-redact than under-redact
- Even if a person holds an official role, their name is PII and must be redacted. Only the role title is preserved.`

const PII_LIGHT_PROMPT = `You are a PII redaction specialist for a South African residential body corporate platform.

Your task: Perform a LIGHT redaction — remove only highly sensitive identifiers while preserving scheme-level information that owners have a statutory right to inspect under STSMA PMR 26(2).

REDACT these categories:
- SA ID numbers (13-digit): [REDACTED_ID_NUMBER]
- Bank account numbers and banking details: [REDACTED_BANK_ACCOUNT]
- Personal email addresses (not scheme/management emails): [REDACTED_EMAIL]
- Personal phone numbers: [REDACTED_PHONE]
- Signatures and handwritten annotations: [REDACTED_SIGNATURE]
- Personal home addresses (not unit numbers, not the building address): [REDACTED_ADDRESS]

PRESERVE (do NOT redact):
- Owner names, trustee names, attendee names — these are part of scheme records
- Unit numbers
- The building name "The Yacht Club" or its address
- Company names (AMDEC, management companies, contractors)
- Levy amounts, special levy amounts, budget figures
- Voting records and attendance lists
- Meeting minutes content, resolution text
- Financial statements figures (income, expenses, reserves)
- Dates, meeting references, resolution numbers
- Role titles and the names alongside them (e.g. "John Smith, Chairman" stays as-is)
- All scheme-level financial figures
- Contractor names and service provider details

RULES:
- Return ONLY the redacted text, nothing else
- Preserve all formatting (paragraphs, bullet points, line breaks)
- This is a LIGHT scrub — err on the side of preserving information
- Only redact direct personal identifiers (ID numbers, bank accounts, personal contact details)
- Names of people involved in scheme governance are NOT private — they are part of the public record of the body corporate`

/**
 * Scrubs PII from document text using Claude for context-aware detection.
 * Returns the scrubbed text with [REDACTED_*] markers.
 *
 * @param text - The raw document text
 * @param level - 'light' preserves names/amounts, 'heavy' redacts everything personal
 */
export async function scrubPII(text: string, level: 'light' | 'heavy' = 'heavy', documentId?: string): Promise<string> {
  if (!text || text.trim().length === 0) return text

  const client = getAnthropicClient()
  const systemPrompt = level === 'light' ? PII_LIGHT_PROMPT : PII_HEAVY_PROMPT

  // For very long documents, process in segments to stay within token limits
  const maxChars = 15000
  if (text.length > maxChars) {
    return await scrubLongText(client, text, maxChars, systemPrompt, documentId)
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Redact PII from the following document text:\n\n${text}`,
      },
    ],
  })

  logUsage({
    service: 'anthropic',
    model: 'claude-sonnet-4-6',
    operation: 'pii_scrub',
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    document_id: documentId,
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  return content.text
}

/**
 * Handles long documents by splitting into overlapping segments,
 * scrubbing each, and reassembling.
 */
async function scrubLongText(
  client: Anthropic,
  text: string,
  segmentSize: number,
  systemPrompt: string,
  documentId?: string
): Promise<string> {
  const overlap = 200
  const segments: string[] = []
  let offset = 0

  while (offset < text.length) {
    const end = Math.min(offset + segmentSize, text.length)
    segments.push(text.slice(offset, end))
    offset = end - overlap
    if (end === text.length) break
  }

  const scrubbed: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Redact PII from the following document text (segment ${i + 1} of ${segments.length}):\n\n${segments[i]}`,
        },
      ],
    })

    logUsage({
      service: 'anthropic',
      model: 'claude-sonnet-4-6',
      operation: 'pii_scrub',
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      document_id: documentId,
    })

    const content = message.content[0]
    if (!content || content.type !== 'text') throw new Error('Unexpected response type from Claude')

    if (i === 0) {
      scrubbed.push(content.text)
    } else {
      // Trim the overlap from the beginning of subsequent segments
      // Find approximately where the new content starts
      const trimmed = content.text.slice(overlap)
      scrubbed.push(trimmed)
    }
  }

  return scrubbed.join('')
}
