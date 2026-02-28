/**
 * GET /api/dashboard/patterns
 * Detects patterns across issues — groups similar issues by category
 * to surface "N owners reported the same problem" insights.
 * Admin only.
 */
export default defineEventHandler(async (event) => {
  const supabase = useSupabaseAdmin()

  const authHeader = getHeader(event, 'authorization')
  if (!authHeader) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'trustee', 'lawyer'].includes(profile.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Find categories with multiple open/in-progress issues
  const { data: issues } = await supabase
    .from('issues')
    .select('id, title, status, severity, category_id, created_by, categories:category_id(name), profiles:created_by(full_name, unit_number)')
    .in('status', ['open', 'in_progress', 'escalated'])
    .not('category_id', 'is', null)
    .order('created_at', { ascending: false })

  if (!issues || issues.length === 0) return { patterns: [] }

  // Group by category
  const groups: Record<string, { category: string; issues: any[] }> = {}
  for (const issue of issues) {
    const catId = issue.category_id
    if (!groups[catId]) {
      groups[catId] = { category: (issue.categories as any)?.name || 'Unknown', issues: [] }
    }
    groups[catId].issues.push(issue)
  }

  // Only return patterns where 2+ owners reported issues in the same category
  const patterns = Object.values(groups)
    .filter(g => {
      const uniqueReporters = new Set(g.issues.map(i => i.created_by))
      return uniqueReporters.size >= 2
    })
    .map(g => {
      const uniqueReporters = new Set(g.issues.map(i => i.created_by))
      const hasCritical = g.issues.some(i => i.severity === 'critical' || i.severity === 'high')
      return {
        category: g.category,
        issueCount: g.issues.length,
        reporterCount: uniqueReporters.size,
        hasCritical,
        issues: g.issues.slice(0, 5).map(i => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          reporter: (i.profiles as any)?.full_name || 'Unknown',
          unit: (i.profiles as any)?.unit_number || null,
        })),
      }
    })
    .sort((a, b) => b.reporterCount - a.reporterCount)

  return { patterns }
})
