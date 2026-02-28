<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()

const issues = ref<any[]>([])
const loading = ref(true)
const filterStatus = ref('')

const statusOptions = [
  { label: 'All statuses', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
  { label: 'Escalated', value: 'escalated' },
]

async function fetchIssues() {
  loading.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const params: Record<string, string> = {}
    if (filterStatus.value) params.status = filterStatus.value

    const query = new URLSearchParams(params).toString()
    issues.value = await $fetch(`/api/issues${query ? '?' + query : ''}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
  } catch { /* empty */ } finally {
    loading.value = false
  }
}

watch(filterStatus, fetchIssues)
onMounted(fetchIssues)

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

const severityColor: Record<string, string> = {
  low: 'neutral',
  normal: 'primary',
  high: 'warning',
  critical: 'error',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Issues</h1>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Report and track building issues</p>
      </div>
      <UButton label="Report issue" icon="i-heroicons-plus" to="/issues/new" />
    </div>

    <!-- Filters -->
    <div class="mb-4">
      <USelect
        v-model="filterStatus"
        :items="statusOptions"
        value-key="value"
        class="w-44"
      />
    </div>

    <!-- List -->
    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>
    <div v-else-if="issues.length === 0" class="text-center py-16">
      <UIcon name="i-heroicons-exclamation-triangle" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p class="text-sm text-gray-400">No issues found</p>
    </div>
    <div v-else class="space-y-3">
      <NuxtLink
        v-for="issue in issues"
        :key="issue.id"
        :to="`/issues/${issue.id}`"
        class="block"
      >
        <UCard class="hover:ring-1 hover:ring-primary-300 dark:hover:ring-primary-700 transition-all">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate">{{ issue.title }}</h3>
                <UBadge :color="statusColor[issue.status] || 'neutral'" variant="subtle" size="xs">
                  {{ issue.status.replace('_', ' ') }}
                </UBadge>
                <UBadge :color="severityColor[issue.severity] || 'neutral'" variant="outline" size="xs">
                  {{ issue.severity }}
                </UBadge>
              </div>
              <p v-if="issue.description" class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{{ issue.description }}</p>
              <div class="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>{{ issue.profiles?.full_name || 'Unknown' }}</span>
                <span v-if="issue.categories?.name">{{ issue.categories.name }}</span>
                <span>{{ formatDate(issue.created_at) }}</span>
              </div>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-5 h-5 text-gray-300 flex-shrink-0" />
          </div>
        </UCard>
      </NuxtLink>
    </div>
  </div>
</template>
