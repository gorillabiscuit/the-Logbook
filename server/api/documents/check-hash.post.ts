/**
 * POST /api/documents/check-hash
 * Pre-upload duplicate check. Client computes SHA-256 of file bytes and sends it here.
 * Returns whether a matching canonical document exists.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const fileHash = body?.file_hash

  if (!fileHash || typeof fileHash !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'file_hash is required' })
  }

  const supabase = useSupabaseAdmin()

  const { data } = await supabase.rpc('find_file_hash_match', {
    p_hash: fileHash,
    p_exclude_id: null,
  })

  if (data && data.length > 0) {
    const match = data[0]
    return {
      isDuplicate: true,
      match: {
        id: match.id,
        title: match.title,
        created_at: match.created_at,
        privacy_level: match.privacy_level,
      },
    }
  }

  return { isDuplicate: false }
})
