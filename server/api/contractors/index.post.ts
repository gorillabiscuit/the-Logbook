/**
 * POST /api/contractors
 * Adds a contractor. Restricted to admins and managers.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const allowed = ['super_admin', 'trustee', 'building_manager', 'management_co']
  if (!profile || !allowed.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event)
  if (!body?.name?.trim() || !body?.speciality?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Name and speciality are required' })
  }

  const { data, error } = await supabase
    .from('contractors')
    .insert({
      name: body.name.trim(),
      company: body.company?.trim() || null,
      speciality: body.speciality.trim(),
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      notes: body.notes?.trim() || null,
      added_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return data
})
