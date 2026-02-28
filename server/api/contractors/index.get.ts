/**
 * GET /api/contractors
 * Lists active contractors with average ratings.
 */
export default defineEventHandler(async () => {
  const supabase = useSupabaseAdmin()

  const { data: contractors, error } = await supabase
    .from('contractors')
    .select('id, name, company, speciality, phone, email, notes, is_active, created_at, added_by, profiles:added_by(full_name)')
    .eq('is_active', true)
    .order('name')

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  // Fetch ratings for all contractors
  const { data: ratings } = await supabase
    .from('contractor_ratings')
    .select('contractor_id, rating')

  // Compute averages
  const ratingMap: Record<string, { total: number; count: number }> = {}
  for (const r of ratings ?? []) {
    if (!ratingMap[r.contractor_id]) ratingMap[r.contractor_id] = { total: 0, count: 0 }
    ratingMap[r.contractor_id].total += r.rating
    ratingMap[r.contractor_id].count += 1
  }

  const result = (contractors ?? []).map(c => ({
    ...c,
    avg_rating: ratingMap[c.id] ? Math.round((ratingMap[c.id].total / ratingMap[c.id].count) * 10) / 10 : null,
    rating_count: ratingMap[c.id]?.count ?? 0,
  }))

  return result
})
