/**
 * GET /api/dashboard/stats
 * Returns comprehensive dashboard statistics for authenticated users.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile?.role && ['super_admin', 'trustee'].includes(profile.role)

  // Run all queries in parallel
  const [
    docCount,
    processedDocs,
    failedDocs,
    flaggedDocs,
    openIssues,
    escalatedIssues,
    totalIssues,
    noticeCount,
    contractorCount,
    userCount,
    recentDocs,
    recentIssues,
  ] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('processing_status', 'completed'),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('processing_status', 'failed'),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('processing_status', 'flagged_for_review'),
    supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'escalated'),
    supabase.from('issues').select('id', { count: 'exact', head: true }),
    supabase.from('notices').select('id', { count: 'exact', head: true }),
    supabase.from('contractors').select('id', { count: 'exact', head: true }).eq('is_active', true),
    isAdmin ? supabase.from('profiles').select('id', { count: 'exact', head: true }) : Promise.resolve({ count: 0 }),
    supabase.from('documents').select('id, title, processing_status, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('issues').select('id, title, status, severity, created_at, profiles:created_by(full_name)').order('created_at', { ascending: false }).limit(5),
  ])

  return {
    documents: {
      total: docCount.count ?? 0,
      processed: processedDocs.count ?? 0,
      failed: failedDocs.count ?? 0,
      flagged: flaggedDocs.count ?? 0,
    },
    issues: {
      total: totalIssues.count ?? 0,
      open: openIssues.count ?? 0,
      escalated: escalatedIssues.count ?? 0,
    },
    notices: noticeCount.count ?? 0,
    contractors: contractorCount.count ?? 0,
    users: userCount.count ?? 0,
    recentDocuments: recentDocs.data ?? [],
    recentIssues: recentIssues.data ?? [],
  }
})
