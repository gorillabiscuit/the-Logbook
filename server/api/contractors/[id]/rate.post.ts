/**
 * POST /api/contractors/:id/rate
 * Rate a contractor (1-5). One rating per user per contractor (upsert).
 */
export default defineEventHandler(async (event) => {
  const contractorId = getRouterParam(event, 'id')
  if (!contractorId) throw createError({ statusCode: 400, statusMessage: 'Contractor ID required' })

  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const rating = Number(body?.rating)
  if (!rating || rating < 1 || rating > 5) {
    throw createError({ statusCode: 400, statusMessage: 'Rating must be 1-5' })
  }

  const { error } = await supabase
    .from('contractor_ratings')
    .upsert(
      {
        contractor_id: contractorId,
        rated_by: user.id,
        rating,
        comment: body.comment?.trim() || null,
      },
      { onConflict: 'contractor_id,rated_by' }
    )

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
