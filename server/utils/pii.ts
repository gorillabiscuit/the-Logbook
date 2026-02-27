/**
 * PII detection and scrubbing using Claude API.
 * Context-aware for South African formats: ID numbers, phone numbers,
 * bank accounts, addresses. Preserves public-role identifiers
 * (e.g. "Chairman of the body corporate") while redacting personal details.
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

const PII_SYSTEM_PROMPT = `You are a PII redaction specialist for a South African residential body corporate platform.

Your task: Replace personally identifiable information with typed placeholders, while preserving context needed for building management.

REDACT these categories:
- SA ID numbers (13-digit): [REDACTED_ID_NUMBER]
- Phone numbers (landline +27 or 0xx, mobile): [REDACTED_PHONE]
- Email addresses: [REDACTED_EMAIL]
- Physical/postal addresses (when identifying a person's residence, NOT the building itself): [REDACTED_ADDRESS]
- Bank account numbers: [REDACTED_BANK_ACCOUNT]
- Financial amounts tied to specific individuals: [REDACTED_AMOUNT]

DO NOT REDACT:
- Names of people acting in official capacity (trustees, chairman, building manager, lawyers, contractors) — these are public roles
- The building name "The Yacht Club" or its address
- Company names (AMDEC, management companies, contractor businesses)
- Unit numbers (these are building references, not personal addresses)
- Dates, meeting references, resolution numbers
- General financial figures (levy amounts, budgets) that aren't tied to one person's private finances

RULES:
- Return ONLY the redacted text, nothing else
- Preserve all formatting (paragraphs, bullet points, line breaks)
- If zero PII is found, return the text unchanged
- When in doubt, redact — it's safer to over-redact than under-redact`

/**
 * Scrubs PII from document text using Claude for context-aware detection.
 * Returns the scrubbed text with [REDACTED_*] markers.
 */
export async function scrubPII(text: string): Promise<string> {
  if (!text || text.trim().length === 0) return text

  const client = getAnthropicClient()

  // For very long documents, process in segments to stay within token limits
  const maxChars = 15000
  if (text.length > maxChars) {
    return await scrubLongText(client, text, maxChars)
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: PII_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Redact PII from the following document text:\n\n${text}`,
      },
    ],
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
  segmentSize: number
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
      system: PII_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Redact PII from the following document text (segment ${i + 1} of ${segments.length}):\n\n${segments[i]}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

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
