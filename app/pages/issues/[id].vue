<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const issue = ref<any>(null)
const loading = ref(true)

const statusOptions = [
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
  { label: 'Escalated', value: 'escalated' },
]

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchIssue() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    issue.value = await $fetch(`/api/issues/${route.params.id}`, { headers })
  } catch (err: any) {
    toast.add({ title: 'Failed to load issue', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function updateStatus(newStatus: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/issues/${route.params.id}`, {
      method: 'PATCH',
      headers,
      body: { status: newStatus },
    })
    toast.add({ title: `Status updated to ${newStatus.replace('_', ' ')}`, color: 'success' })
    await fetchIssue()
  } catch (err: any) {
    toast.add({ title: 'Failed to update', description: err?.data?.message || err.message, color: 'error' })
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
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

onMounted(fetchIssue)
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center gap-2 mb-6">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" size="sm" to="/issues" />
      <h1 v-if="issue" class="text-2xl font-bold text-gray-900 dark:text-white truncate">{{ issue.title }}</h1>
      <h1 v-else class="text-2xl font-bold text-gray-400">Loading...</h1>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>

    <template v-else-if="issue">
      <!-- Status & meta bar -->
      <div class="flex flex-wrap items-center gap-3 mb-6">
        <UBadge :color="statusColor[issue.status] || 'neutral'" variant="subtle">
          {{ issue.status.replace('_', ' ') }}
        </UBadge>
        <UBadge :color="severityColor[issue.severity] || 'neutral'" variant="outline">
          {{ issue.severity }}
        </UBadge>
        <span v-if="issue.categories?.name" class="text-sm text-gray-500">{{ issue.categories.name }}</span>
        <span class="text-sm text-gray-400">Reported by {{ issue.profiles?.full_name || 'Unknown' }}</span>
        <span class="text-sm text-gray-400">{{ formatDate(issue.created_at) }}</span>
        <span v-if="issue.resolved_at" class="text-sm text-green-500">Resolved {{ formatDate(issue.resolved_at) }}</span>
      </div>

      <!-- Description -->
      <UCard class="mb-6">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">Description</h2>
        <p v-if="issue.description" class="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{{ issue.description }}</p>
        <p v-else class="text-sm text-gray-400 italic">No description provided</p>
      </UCard>

      <!-- Linked documents -->
      <UCard v-if="issue.linked_documents?.length" class="mb-6">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">Linked Documents</h2>
        <div class="space-y-1">
          <NuxtLink
            v-for="ld in issue.linked_documents"
            :key="ld.document_id"
            :to="`/documents/${ld.documents?.id}`"
            class="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
          >
            <UIcon name="i-heroicons-document-text" class="w-4 h-4" />
            {{ ld.documents?.title || ld.documents?.original_filename || 'Document' }}
          </NuxtLink>
        </div>
      </UCard>

      <!-- Admin actions -->
      <UCard v-if="isAdmin">
        <h2 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Update Status</h2>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="opt in statusOptions"
            :key="opt.value"
            :label="opt.label"
            :variant="issue.status === opt.value ? 'solid' : 'outline'"
            size="sm"
            :disabled="issue.status === opt.value"
            @click="updateStatus(opt.value)"
          />
        </div>
      </UCard>
    </template>
  </div>
</template>
