<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const { isAdmin } = useAuth()
const toast = useToast()

const entities = ref<any[]>([])
const loading = ref(true)
const filterType = ref('')
const filterConfirmed = ref('all')

const entityTypes = [
  { label: 'All types', value: '' },
  { label: 'Asset', value: 'asset' },
  { label: 'Contractor', value: 'contractor' },
  { label: 'Person', value: 'person' },
  { label: 'Contract', value: 'contract' },
  { label: 'Rule', value: 'rule' },
  { label: 'Decision', value: 'decision' },
  { label: 'Promise', value: 'promise' },
  { label: 'Event', value: 'event' },
]

const confirmedOptions = [
  { label: 'All', value: 'all' },
  { label: 'Confirmed', value: 'true' },
  { label: 'Unconfirmed', value: 'false' },
]

const typeIcon: Record<string, string> = {
  asset: 'i-heroicons-building-office',
  contractor: 'i-heroicons-wrench-screwdriver',
  person: 'i-heroicons-user',
  contract: 'i-heroicons-document-text',
  rule: 'i-heroicons-scale',
  decision: 'i-heroicons-check-circle',
  promise: 'i-heroicons-hand-raised',
  event: 'i-heroicons-calendar-days',
}

const typeColor: Record<string, string> = {
  asset: 'primary',
  contractor: 'success',
  person: 'neutral',
  contract: 'warning',
  rule: 'error',
  decision: 'primary',
  promise: 'warning',
  event: 'neutral',
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

async function fetchEntities() {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    const params: Record<string, string> = {}
    if (filterType.value) params.type = filterType.value
    if (filterConfirmed.value !== 'all') params.confirmed = filterConfirmed.value

    const query = new URLSearchParams(params).toString()
    entities.value = await $fetch(`/api/admin/entities${query ? '?' + query : ''}`, { headers })
  } catch (err: any) {
    toast.add({ title: 'Failed to load entities', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function confirmEntity(id: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/admin/entities/${id}`, {
      method: 'PATCH',
      headers,
      body: { is_confirmed: true },
    })
    toast.add({ title: 'Entity confirmed', color: 'success' })
    await fetchEntities()
  } catch (err: any) {
    toast.add({ title: 'Failed to confirm', description: err?.data?.message || err.message, color: 'error' })
  }
}

async function deleteEntity(id: string) {
  try {
    const headers = await getAuthHeaders()
    await $fetch(`/api/admin/entities/${id}`, { method: 'DELETE', headers })
    toast.add({ title: 'Entity deleted', color: 'success' })
    await fetchEntities()
  } catch (err: any) {
    toast.add({ title: 'Failed to delete', description: err?.data?.message || err.message, color: 'error' })
  }
}

function formatProperties(props: Record<string, any>) {
  return Object.entries(props || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

watch([filterType, filterConfirmed], fetchEntities)
onMounted(fetchEntities)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Entities discovered from documents. Confirm or remove AI-discovered entries.
        </p>
      </div>
    </div>

    <div v-if="!isAdmin" class="text-center py-12">
      <p class="text-gray-500">Admin access required.</p>
    </div>

    <template v-else>
      <!-- Filters -->
      <div class="flex gap-3 mb-4">
        <USelect v-model="filterType" :items="entityTypes" value-key="value" class="w-44" />
        <USelect v-model="filterConfirmed" :items="confirmedOptions" value-key="value" class="w-36" />
      </div>

      <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>

      <div v-else-if="entities.length === 0" class="text-center py-16">
        <UIcon name="i-heroicons-share" class="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p class="text-sm text-gray-400">
          No entities yet. Entities will be auto-discovered as documents are processed.
        </p>
      </div>

      <div v-else class="space-y-2">
        <UCard v-for="entity in entities" :key="entity.id">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <UIcon :name="typeIcon[entity.entity_type] || 'i-heroicons-cube'" class="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span class="font-medium text-gray-900 dark:text-white">{{ entity.name }}</span>
                <UBadge :color="typeColor[entity.entity_type] || 'neutral'" variant="subtle" size="xs">
                  {{ entity.entity_type }}
                </UBadge>
                <UBadge v-if="entity.is_confirmed" color="success" variant="outline" size="xs">confirmed</UBadge>
                <UBadge v-else color="warning" variant="outline" size="xs">unconfirmed</UBadge>
              </div>
              <p v-if="formatProperties(entity.properties)" class="text-xs text-gray-500 ml-6">
                {{ formatProperties(entity.properties) }}
              </p>
              <NuxtLink
                v-if="entity.documents?.id"
                :to="`/documents/${entity.documents.id}`"
                class="text-xs text-primary-600 hover:text-primary-700 ml-6"
              >
                Source: {{ entity.documents.title || 'View document' }}
              </NuxtLink>
            </div>
            <div class="flex gap-1 flex-shrink-0">
              <UButton
                v-if="!entity.is_confirmed"
                icon="i-heroicons-check"
                variant="ghost"
                size="xs"
                color="success"
                @click="confirmEntity(entity.id)"
              />
              <UButton
                icon="i-heroicons-trash"
                variant="ghost"
                size="xs"
                color="error"
                @click="deleteEntity(entity.id)"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </div>
</template>
