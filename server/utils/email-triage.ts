/**
 * AI body triage — uses Claude Haiku to classify whether an email body
 * is substantive (complaint, issue report, detailed context) or trivial
 * ("see attached", signature-only, forwarding boilerplate).
 *
 * Fast paths avoid the AI call entirely for obvious cases.
 * On any failure, defaults to isSubstantive: true (safer to over-include).
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

interface TriageResult {
  isSubstantive: boolean
  reason: string
}

/** Lines that are typically part of an email signature or forwarding header */
const SIGNATURE_PATTERNS = [
  /^-{2,}/,
  /^sent from my/i,
  /^get outlook for/i,
  /^_{2,}/,
  /^this email.*confidential/i,
  /^disclaimer/i,
]

/**
 * Check if the body is only signature/boilerplate lines after stripping whitespace.
 */
function isOnlySignature(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length === 0) return true
  return lines.every(line => SIGNATURE_PATTERNS.some(p => p.test(line)))
}

/**
 * Classifies an email body as substantive or trivial.
 * When attachments are present, this determines whether the body
 * should also be stored as its own document.
 */
export async function triageEmailBody(
  bodyText: string,
  subject: string
): Promise<TriageResult> {
  const trimmed = bodyText.trim()

  // Fast path: empty or very short body
  if (trimmed.length < 20) {
    return { isSubstantive: false, reason: 'Body too short to be substantive' }
  }

  // Fast path: only signature lines
  if (isOnlySignature(trimmed)) {
    return { isSubstantive: false, reason: 'Body contains only signature/boilerplate' }
  }

  // AI classification
  try {
    const client = getAnthropicClient()
    const truncated = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `You classify email bodies as "substantive" or "trivial". Respond with ONLY a JSON object: {"substantive": true/false, "reason": "brief reason"}

Substantive: complaints, issue reports, questions, detailed context, instructions, decisions, meeting notes.
Trivial: "see attached", "please find attached", "FYI", forwarding boilerplate, signature-only, one-word replies.`,
      messages: [
        {
          role: 'user',
          content: `Subject: ${subject}\n\nBody:\n${truncated}`,
        },
      ],
    })

    logUsage({
      service: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      operation: 'email_triage',
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    })

    const content = message.content[0]
    if (content?.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          isSubstantive: !!parsed.substantive,
          reason: parsed.reason || 'AI classification',
        }
      }
    }
  } catch (err) {
    console.error('Email body triage failed, defaulting to substantive:', err)
  }

  // Default to substantive on any failure
  return { isSubstantive: true, reason: 'Default: triage failed, keeping body' }
}
