/**
 * GET /api/reports/export?type=issues|documents|summary
 * Generates a JSON report for export. Admin/lawyer only.
 * The frontend converts this to a downloadable format.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()
  const query = getQuery(event)

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee', 'lawyer'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const reportType = (query.type as string) || 'summary'

  if (reportType === 'issues') {
    const { data: issues } = await supabase
      .from('issues')
      .select('id, title, description, status, severity, privacy_level, created_at, resolved_at, profiles:created_by(full_name, unit_number), categories:category_id(name)')
      .order('created_at', { ascending: false })

    return {
      reportType: 'issues',
      generatedAt: new Date().toISOString(),
      count: issues?.length ?? 0,
      data: issues ?? [],
    }
  }

  if (reportType === 'documents') {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, title, original_filename, doc_type, doc_date, privacy_level, processing_status, ai_summary, ai_confidence, created_at')
      .order('created_at', { ascending: false })

    return {
      reportType: 'documents',
      generatedAt: new Date().toISOString(),
      count: docs?.length ?? 0,
      data: docs ?? [],
    }
  }

  // Summary report
  const [docCount, issuesByStatus, issuesBySeverity, docsByType] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('issues').select('status'),
    supabase.from('issues').select('severity').in('status', ['open', 'in_progress', 'escalated']),
    supabase.from('documents').select('doc_type'),
  ])

  // Aggregate
  const statusCounts: Record<string, number> = {}
  for (const i of issuesByStatus.data ?? []) {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1
  }

  const severityCounts: Record<string, number> = {}
  for (const i of issuesBySeverity.data ?? []) {
    severityCounts[i.severity] = (severityCounts[i.severity] || 0) + 1
  }

  const typeCounts: Record<string, number> = {}
  for (const d of docsByType.data ?? []) {
    const t = d.doc_type || 'untyped'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  }

  return {
    reportType: 'summary',
    generatedAt: new Date().toISOString(),
    documents: { total: docCount.count ?? 0, byType: typeCounts },
    issues: { byStatus: statusCounts, openBySeverity: severityCounts },
  }
})
