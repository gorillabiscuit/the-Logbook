<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { profile, isAdmin } = useAuth()
const supabase = useSupabaseClient()

const loading = ref(true)
const stats = ref<any>(null)
const patterns = ref<any[]>([])

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchDashboard() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    const [statsData, patternsData] = await Promise.all([
      $fetch<any>('/api/dashboard/stats', { headers }),
      isAdmin.value
        ? $fetch<any>('/api/dashboard/patterns', { headers }).catch(() => ({ patterns: [] }))
        : Promise.resolve({ patterns: [] }),
    ])
    stats.value = statsData
    patterns.value = patternsData.patterns ?? []
  } catch { /* empty */ } finally {
    loading.value = false
  }
}

onMounted(fetchDashboard)

const quickLinks = [
  { label: 'Upload a document', icon: 'i-heroicons-arrow-up-tray', to: '/documents/upload', color: 'primary' as const },
  { label: 'Browse documents', icon: 'i-heroicons-document-text', to: '/documents', color: 'neutral' as const },
  { label: 'Report an issue', icon: 'i-heroicons-exclamation-triangle', to: '/issues/new', color: 'warning' as const },
  { label: 'Ask the AI', icon: 'i-heroicons-chat-bubble-left-right', to: '/chat', color: 'success' as const },
]

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })
}

const statusColor: Record<string, string> = {
  open: 'warning',
  in_progress: 'primary',
  resolved: 'success',
  closed: 'neutral',
  escalated: 'error',
}

const processingColor: Record<string, string> = {
  completed: 'success',
  processing: 'primary',
  pending: 'neutral',
  failed: 'error',
  flagged_for_review: 'warning',
}
</script>

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
        Welcome back{{ profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : '' }}
      </h1>
      <p class="text-gray-500 dark:text-gray-400 mt-1">
        The Yacht Club Residential Body Corporate — Collective Knowledge Platform
      </p>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400">Loading dashboard...</div>

    <template v-else-if="stats">
      <!-- Stats grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.documents.total }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Documents</div>
            <div v-if="stats.documents.flagged > 0" class="text-xs text-amber-500 mt-1">{{ stats.documents.flagged }} need review</div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-warning-600 dark:text-warning-400">{{ stats.issues.open }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Open Issues</div>
            <div v-if="stats.issues.escalated > 0" class="text-xs text-red-500 mt-1">{{ stats.issues.escalated }} escalated</div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.notices }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Notices</div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-gray-900 dark:text-white">{{ stats.contractors }}</div>
            <div class="text-sm text-gray-500 dark:text-gray-400 mt-1">Active Contractors</div>
            <div v-if="isAdmin && stats.users > 0" class="text-xs text-gray-400 mt-1">{{ stats.users }} users</div>
          </div>
        </UCard>
      </div>

      <!-- Document processing stats (admin only) -->
      <div v-if="isAdmin && (stats.documents.failed > 0 || stats.documents.flagged > 0)" class="mb-6">
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="stats.documents.flagged > 0" to="/admin/flagged">
            <UBadge color="warning" variant="soft" size="md">
              {{ stats.documents.flagged }} flagged for review
            </UBadge>
          </NuxtLink>
          <UBadge v-if="stats.documents.failed > 0" color="error" variant="soft" size="md">
            {{ stats.documents.failed }} processing failed
          </UBadge>
          <UBadge color="success" variant="soft" size="md">
            {{ stats.documents.processed }} processed
          </UBadge>
        </div>
      </div>

      <!-- Pattern alerts (admin only) -->
      <div v-if="isAdmin && patterns.length > 0" class="mb-8">
        <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-3">Pattern Alerts</h2>
        <div class="space-y-2">
          <UCard v-for="(pattern, idx) in patterns.slice(0, 3)" :key="idx">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <UIcon name="i-heroicons-exclamation-triangle" :class="pattern.hasCritical ? 'text-red-500' : 'text-amber-500'" class="w-5 h-5 flex-shrink-0" />
                  <span class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ pattern.reporterCount }} owners reported issues in "{{ pattern.category }}"
                  </span>
                </div>
                <p class="text-xs text-gray-500 mt-1 ml-7">{{ pattern.issueCount }} total issues</p>
              </div>
              <UBadge v-if="pattern.hasCritical" color="error" variant="soft" size="xs">critical</UBadge>
            </div>
          </UCard>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="mb-8">
        <h2 class="text-base font-semibold text-gray-900 dark:text-white mb-3">Quick actions</h2>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <UButton
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            :icon="link.icon"
            :label="link.label"
            :color="link.color"
            variant="soft"
            class="justify-start h-auto py-3"
          />
        </div>
      </div>

      <!-- Recent activity -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent documents -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">Recent Documents</h2>
            <NuxtLink to="/documents" class="text-xs text-primary-600 hover:text-primary-700">View all</NuxtLink>
          </div>
          <UCard v-if="stats.recentDocuments?.length">
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div v-for="doc in stats.recentDocuments" :key="doc.id" class="py-2 first:pt-0 last:pb-0">
                <NuxtLink :to="`/documents/${doc.id}`" class="flex items-center justify-between gap-2 group">
                  <span class="text-sm text-gray-900 dark:text-white group-hover:text-primary-600 truncate">{{ doc.title || 'Untitled' }}</span>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <UBadge :color="processingColor[doc.processing_status] || 'neutral'" variant="subtle" size="xs">
                      {{ doc.processing_status }}
                    </UBadge>
                    <span class="text-xs text-gray-400">{{ formatDate(doc.created_at) }}</span>
                  </div>
                </NuxtLink>
              </div>
            </div>
          </UCard>
          <UCard v-else>
            <p class="text-center text-sm text-gray-400 py-4">No documents yet</p>
          </UCard>
        </div>

        <!-- Recent issues -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">Recent Issues</h2>
            <NuxtLink to="/issues" class="text-xs text-primary-600 hover:text-primary-700">View all</NuxtLink>
          </div>
          <UCard v-if="stats.recentIssues?.length">
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div v-for="issue in stats.recentIssues" :key="issue.id" class="py-2 first:pt-0 last:pb-0">
                <NuxtLink :to="`/issues/${issue.id}`" class="flex items-center justify-between gap-2 group">
                  <span class="text-sm text-gray-900 dark:text-white group-hover:text-primary-600 truncate">{{ issue.title }}</span>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <UBadge :color="statusColor[issue.status] || 'neutral'" variant="subtle" size="xs">
                      {{ issue.status.replace('_', ' ') }}
                    </UBadge>
                    <span class="text-xs text-gray-400">{{ formatDate(issue.created_at) }}</span>
                  </div>
                </NuxtLink>
              </div>
            </div>
          </UCard>
          <UCard v-else>
            <p class="text-center text-sm text-gray-400 py-4">No issues yet</p>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
