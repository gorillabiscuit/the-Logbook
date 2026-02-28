/**
 * AI-powered entity extraction using Claude.
 * Discovers entities (people, contractors, assets, contracts, rules, decisions,
 * promises, events) from document text and populates the knowledge graph.
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

interface ExtractedEntity {
  name: string
  entityType: string
  properties: Record<string, any>
  contextSnippet: string
}

interface ExtractedRelation {
  entityA: string // name reference
  entityB: string // name reference
  relationType: string
}

interface ExtractionResult {
  entities: ExtractedEntity[]
  relations: ExtractedRelation[]
}

/**
 * Extracts entities and relationships from document text using Claude.
 * Inserts discovered entities into the database as unconfirmed.
 */
export async function extractEntities(
  text: string,
  documentId: string
): Promise<{ entitiesCreated: number; relationsCreated: number }> {
  const supabase = useSupabaseAdmin()
  const client = getAnthropicClient()

  // Truncate for token limits
  const truncatedText = text.length > 10000 ? text.slice(0, 10000) + '\n\n[... text truncated ...]' : text

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are an entity extraction AI for a South African residential body corporate (The Yacht Club, Cape Town). Extract structured entities and relationships from documents.

You must respond with ONLY a JSON object (no markdown, no explanation):
{
  "entities": [
    {
      "name": "<entity name>",
      "entityType": "<one of: asset, contractor, person, contract, rule, decision, promise, event>",
      "properties": { "<key>": "<value>" },
      "contextSnippet": "<brief surrounding text where entity was found>"
    }
  ],
  "relations": [
    {
      "entityA": "<entity name>",
      "entityB": "<entity name>",
      "relationType": "<one of: maintained_by, located_in, governed_by, promised_in, contradicted_by, party_to, employed_by, manages, related_to>"
    }
  ]
}

Entity type guidelines:
- **asset**: Physical items — lifts, pool, parking, HVAC, fire equipment, specific building components
- **contractor**: Companies or individuals providing services — plumbers, electricians, managing agents
- **person**: Named individuals mentioned — trustees, managers, owners, lawyers, directors
- **contract**: Named agreements — management agreements, service contracts, deeds of sale
- **rule**: Specific rules, bylaws, constitutional provisions, or conduct rules mentioned
- **decision**: Specific decisions made at meetings, by trustees, or by management
- **promise**: Commitments, undertakings, or promises made by any party (especially developer)
- **event**: Specific dated events — meetings, incidents, inspections, handovers

Rules:
- Only extract clearly identifiable entities, not vague references
- For people, include role/position in properties if mentioned (e.g. {"role": "chairman", "unit": "42"})
- For contractors, include speciality if mentioned (e.g. {"speciality": "plumbing"})
- For promises, include who made the promise and to whom in properties
- contextSnippet should be 1-2 sentences showing where the entity appears
- Do NOT extract generic terms like "the building" or "the owners" — only specific named entities
- Aim for quality over quantity — 3-10 entities per document is typical
- Relations should only link entities you've extracted in this same response`,
    messages: [
      {
        role: 'user',
        content: `Extract entities and relationships from this document:\n\n${truncatedText}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  let parsed: ExtractionResult
  try {
    let jsonStr = content.text
    jsonStr = jsonStr.replace(/```json\n?|\n?```/g, '')
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON object found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch (parseError) {
    console.error('Failed to parse entity extraction response:', content.text, parseError)
    return { entitiesCreated: 0, relationsCreated: 0 }
  }

  if (!Array.isArray(parsed.entities)) {
    return { entitiesCreated: 0, relationsCreated: 0 }
  }

  const validTypes = ['asset', 'contractor', 'person', 'contract', 'rule', 'decision', 'promise', 'event']
  const entityIdMap: Record<string, string> = {} // name → db id
  let entitiesCreated = 0
  let relationsCreated = 0

  for (const entity of parsed.entities) {
    if (!entity.name?.trim() || !validTypes.includes(entity.entityType)) continue

    // Check if entity already exists (by name and type)
    const { data: existing } = await supabase
      .from('entities')
      .select('id')
      .eq('name', entity.name.trim())
      .eq('entity_type', entity.entityType)
      .limit(1)
      .single()

    let entityId: string

    if (existing) {
      entityId = existing.id
    } else {
      // Create new unconfirmed entity
      const { data: created, error } = await supabase
        .from('entities')
        .insert({
          entity_type: entity.entityType,
          name: entity.name.trim(),
          properties: entity.properties || {},
          discovered_from_document_id: documentId,
          is_confirmed: false,
        })
        .select('id')
        .single()

      if (error || !created) continue

      entityId = created.id
      entitiesCreated++
    }

    entityIdMap[entity.name.trim()] = entityId

    // Create entity mention (link entity to document)
    await supabase
      .from('entity_mentions')
      .insert({
        entity_id: entityId,
        document_id: documentId,
        context_snippet: entity.contextSnippet?.slice(0, 500) || null,
      })
      .catch(() => {}) // Ignore duplicate mention errors
  }

  // Create relations
  if (Array.isArray(parsed.relations)) {
    const validRelations = ['maintained_by', 'located_in', 'governed_by', 'promised_in', 'contradicted_by', 'party_to', 'employed_by', 'manages', 'related_to']

    for (const rel of parsed.relations) {
      const entityAId = entityIdMap[rel.entityA?.trim()]
      const entityBId = entityIdMap[rel.entityB?.trim()]

      if (!entityAId || !entityBId || entityAId === entityBId) continue
      if (!validRelations.includes(rel.relationType)) continue

      const { error } = await supabase
        .from('entity_relations')
        .insert({
          entity_a_id: entityAId,
          entity_b_id: entityBId,
          relation_type: rel.relationType,
        })

      if (!error) relationsCreated++
    }
  }

  return { entitiesCreated, relationsCreated }
}
