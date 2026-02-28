<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const events = ref<any[]>([])
const loading = ref(true)
const showForm = ref(false)
const filterType = ref('')

const eventTypes = [
  { label: 'All types', value: '' },
  { label: 'AGM', value: 'agm' },
  { label: 'Rule change', value: 'rule_change' },
  { label: 'Maintenance', value: 'maintenance' },
  { label: 'Legal', value: 'legal' },
  { label: 'Financial', value: 'financial' },
  { label: 'Promise', value: 'promise' },
  { label: 'Incident', value: 'incident' },
]

const form = reactive({
  event_date: '',
  title: '',
  description: '',
  event_type: '',
  privacy_level: 'shared',
})

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchEvents() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    const params: Record<string, string> = {}
    if (filterType.value) params.event_type = filterType.value

    const query = new URLSearchParams(params).toString()
    events.value = await $fetch(`/api/timeline${query ? '?' + query : ''}`, { headers })
  } catch { /* empty */ } finally {
    loading.value = false
  }
}

async function createEvent() {
  if (!form.title.trim() || !form.event_date) return
  try {
    const headers = await getAuthHeaders()
    await $fetch('/api/timeline', {
      method: 'POST',
      headers,
      body: { ...form, event_type: form.event_type || null },
    })
    toast.add({ title: 'Event added', color: 'success' })
    showForm.value = false
    form.event_date = ''
    form.title = ''
    form.description = ''
    form.event_type = ''
    form.privacy_level = 'shared'
    await fetchEvents()
  } catch (err: any) {
    toast.add({ title: 'Failed to add event', description: err?.data?.message || err.message, color: 'error' })
  }
}

watch(filterType, fetchEvents)
onMounted(fetchEvents)

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

const typeIcon: Record<string, string> = {
  agm: 'i-heroicons-users',
  rule_change: 'i-heroicons-document-text',
  maintenance: 'i-heroicons-wrench-screwdriver',
  legal: 'i-heroicons-scale',
  financial: 'i-heroicons-banknotes',
  promise: 'i-heroicons-hand-raised',
  incident: 'i-heroicons-exclamation-triangle',
}

const typeColor: Record<string, string> = {
  agm: 'primary',
  rule_change: 'warning',
  maintenance: 'neutral',
  legal: 'error',
  financial: 'success',
  promise: 'primary',
  incident: 'error',
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Scheme Timeline</h1>
        <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">Chronological history of the building</p>
      </div>
      <UButton
        v-if="isAdmin"
        icon="i-heroicons-plus"
        label="Add event"
        @click="showForm = !showForm"
      />
    </div>

    <!-- Create form -->
    <UCard v-if="showForm && isAdmin" class="mb-6">
      <form @submit.prevent="createEvent" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Date" required>
            <UInput v-model="form.event_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Type">
            <USelect v-model="form.event_type" :items="eventTypes.slice(1)" value-key="value" placeholder="Select type" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="What happened?" class="w-full" />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="form.description" placeholder="Details..." :rows="3" class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" variant="ghost" @click="showForm = false" />
          <UButton type="submit" label="Add to timeline" />
        </div>
      </form>
    </UCard>

    <!-- Filter -->
    <div class="mb-4">
      <USelect v-model="filterType" :items="eventTypes" value-key="value" class="w-44" />
    </div>

    <!-- Timeline -->
    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>
    <div v-else-if="events.length === 0" class="text-center py-16">
      <UIcon name="i-heroicons-calendar-days" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
      <p class="text-sm text-gray-400">No timeline events yet</p>
    </div>
    <div v-else class="relative">
      <!-- Vertical line -->
      <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

      <div v-for="evt in events" :key="evt.id" class="relative pl-12 pb-8 last:pb-0">
        <!-- Dot -->
        <div
          class="absolute left-2.5 top-1 w-3 h-3 rounded-full border-2 border-white dark:border-gray-950"
          :class="evt.event_type ? `bg-${typeColor[evt.event_type] || 'neutral'}-500` : 'bg-gray-400'"
        />

        <!-- Content -->
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-medium text-gray-400">{{ formatDate(evt.event_date) }}</span>
                <UBadge v-if="evt.event_type" :color="typeColor[evt.event_type] || 'neutral'" variant="subtle" size="xs">
                  {{ evt.event_type.replace('_', ' ') }}
                </UBadge>
                <UBadge v-if="evt.is_auto_generated" color="neutral" variant="outline" size="xs">auto</UBadge>
              </div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ evt.title }}</h3>
              <p v-if="evt.description" class="text-sm text-gray-500 dark:text-gray-400 mt-1">{{ evt.description }}</p>
            </div>
            <NuxtLink
              v-if="evt.documents?.id"
              :to="`/documents/${evt.documents.id}`"
              class="flex-shrink-0"
            >
              <UButton icon="i-heroicons-document-text" variant="ghost" size="xs" />
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
