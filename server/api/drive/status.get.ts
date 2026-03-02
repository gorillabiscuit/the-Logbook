const ALLOWED_ROLES = ['super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner']
const ADMIN_ROLES = ['super_admin', 'trustee']

/**
 * GET /api/drive/status
 * Returns sync history and stats.
 * Users see their own syncs; admins see all.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  // Auth check
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // Role check
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' })
  }

  const isAdmin = ADMIN_ROLES.includes(profile.role)

  // Build query — admins see all, others see only their own
  let countQuery = supabase
    .from('drive_sync_files')
    .select('*', { count: 'exact', head: true })

  let historyQuery = supabase
    .from('drive_sync_files')
    .select(`
      id,
      google_file_id,
      google_folder_id,
      synced_at,
      synced_by,
      document_id,
      documents:document_id (
        title,
        original_filename,
        processing_status
      ),
      profiles:synced_by (
        full_name
      )
    `)
    .order('synced_at', { ascending: false })
    .limit(100)

  if (!isAdmin) {
    countQuery = countQuery.eq('synced_by', user.id)
    historyQuery = historyQuery.eq('synced_by', user.id)
  }

  const { count: totalSynced } = await countQuery
  const { data: recentSyncs } = await historyQuery

  // Get last sync date
  const lastSync = recentSyncs && recentSyncs.length > 0
    ? recentSyncs[0].synced_at
    : null

  // Group by folder for summary
  const folderCounts: Record<string, number> = {}
  for (const sync of recentSyncs ?? []) {
    folderCounts[sync.google_folder_id] = (folderCounts[sync.google_folder_id] || 0) + 1
  }

  return {
    totalSynced: totalSynced ?? 0,
    lastSync,
    folderCounts,
    recentSyncs: recentSyncs ?? [],
  }
})
