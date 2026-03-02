<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SortingState, VisibilityState } from '@tanstack/vue-table'

definePageMeta({
  middleware: 'auth',
  ssr: false,
})

const supabase = useSupabaseClient()
const toast = useToast()
const { hasRole, profile } = useAuth()
const { query: searchQuery, results: searchResults, totalHits, searching, isSearchMode } = useSearch()

const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))

const route = useRoute()

const selectedPrivacy = ref<string>('all')
const selectedType = ref<string>('all')
const selectedStatus = ref<string>((route.query.status as string) || 'all')
const selectedCategory = ref<string>('all')
const selectedSource = ref<string>('all')
const loading = ref(false)
const documents = ref<any[]>([])
const categories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])

// Table features
const sorting = ref<SortingState>([{ id: 'created_at', desc: true }])
const columnVisibility = ref<VisibilityState>({
  email_from: false,
  email_subject: false,
})
const compact = ref(false)
const tableRef = useTemplateRef('table')

const statusFilterOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Completed', value: 'completed' },
  { label: 'Processing', value: 'processing' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
  { label: 'Flagged', value: 'flagged_for_review' },
]

const privacyFilterOptions = [
  { label: 'All privacy', value: 'all' },
  { label: 'Shared', value: 'shared' },
  { label: 'Private', value: 'private' },
  { label: 'Privileged', value: 'privileged' },
]

const docTypeFilterOptions = [
  { label: 'All types', value: 'all' },
  { label: 'Letter', value: 'letter' },
  { label: 'Contract', value: 'contract' },
  { label: 'Minutes', value: 'minutes' },
  { label: 'Invoice', value: 'invoice' },
  { label: 'Financial statement', value: 'financial_statement' },
  { label: 'Legal opinion', value: 'legal_opinion' },
  { label: 'Photo', value: 'photo' },
  { label: 'Notice', value: 'notice' },
  { label: 'Email', value: 'email' },
  { label: 'Other', value: 'other' },
]

const sourceFilterOptions = [
  { label: 'All sources', value: 'all' },
  { label: 'Web uploads', value: 'web_upload' },
  { label: 'All email', value: 'email_all' },
  { label: 'Email (shared)', value: 'email_shared' },
  { label: 'Email (private)', value: 'email_private' },
]

const privacyColors: Record<string, 'success' | 'warning' | 'error'> = {
  shared: 'success',
  private: 'warning',
  privileged: 'error',
}

const sensitivityColors: Record<string, 'success' | 'warning' | 'error'> = {
  scheme_ops: 'success',
  personal_financial: 'warning',
  privileged_legal: 'error',
}

const sensitivityLabels: Record<string, string> = {
  scheme_ops: 'Scheme Ops',
  personal_financial: 'Personal Financial',
  privileged_legal: 'Privileged',
}

const statusColors: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
  flagged_for_review: 'warning',
}

// Detect stuck documents based on created_at time
function isDocStuck(doc: any): boolean {
  if (!doc.processing_status || !['pending', 'processing'].includes(doc.processing_status)) return false
  const createdAt = new Date(doc.created_at).getTime()
  const now = Date.now()
  const elapsed = now - createdAt
  if (doc.processing_status === 'processing') return elapsed > 10 * 60 * 1000 // 10 min
  if (doc.processing_status === 'pending') return elapsed > 5 * 60 * 1000 // 5 min
  return false
}

const retryingDocId = ref<string | null>(null)
const deletingDocId = ref<string | null>(null)
const deleteModalDocId = ref<string | null>(null)

async function deleteDocument() {
  const docId = deleteModalDocId.value
  if (!docId) return
  deletingDocId.value = docId
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await $fetch(`/api/documents/${docId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    deleteModalDocId.value = null
    toast.add({ title: 'Document deleted', color: 'success' })
    await fetchDocuments()
  } catch (err: any) {
    toast.add({ title: 'Delete failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    deletingDocId.value = null
  }
}

async function retryDocument(docId: string) {
  retryingDocId.value = docId
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await $fetch(`/api/documents/${docId}/reprocess`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    await fetchDocuments()
  } catch {
    // Silently fail — user can try again
  } finally {
    retryingDocId.value = null
  }
}

// Build category filter options (flat with parent > child format)
const categoryFilterOptions = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  const result: Array<{ label: string; value: string }> = [{ label: 'All categories', value: 'all' }]

  for (const parent of parents) {
    result.push({ label: parent.name, value: parent.id })
    const children = categories.value.filter(c => c.parent_id === parent.id)
    for (const child of children) {
      result.push({ label: `  ${parent.name} › ${child.name}`, value: child.id })
    }
  }

  return result
})

const fetchDocuments = async () => {
  loading.value = true

  let query = supabase
    .from('documents')
    .select('id, title, original_filename, privacy_level, sensitivity_tier, doc_type, doc_date, processing_status, ai_summary, created_at, retry_count, uploaded_by, source_channel, email_context')
    .order('created_at', { ascending: false })

  if (selectedPrivacy.value && selectedPrivacy.value !== 'all') query = query.eq('privacy_level', selectedPrivacy.value)
  if (selectedType.value && selectedType.value !== 'all') query = query.eq('doc_type', selectedType.value)
  if (selectedStatus.value && selectedStatus.value !== 'all') query = query.eq('processing_status', selectedStatus.value)
  if (selectedSource.value === 'email_all') {
    query = query.in('source_channel', ['email_shared', 'email_private'])
  } else if (selectedSource.value !== 'all') {
    query = query.eq('source_channel', selectedSource.value)
  }

  // Category filter: join through document_categories
  if (selectedCategory.value && selectedCategory.value !== 'all') {
    const { data: catDocs } = await supabase
      .from('document_categories')
      .select('document_id')
      .eq('category_id', selectedCategory.value)

    const docIds = (catDocs ?? []).map(d => d.document_id)
    if (docIds.length === 0) {
      documents.value = []
      loading.value = false
      return
    }
    query = query.in('id', docIds)
  }

  // Only use DB title search when not in Meilisearch mode
  if (!isSearchMode.value && searchQuery.value) {
    query = query.ilike('title', `%${searchQuery.value}%`)
  }

  const { data, error } = await query.limit(50)

  if (error) {
    // If the query fails (e.g. sensitivity_tier column doesn't exist yet), retry without it
    const fallbackQuery = supabase
      .from('documents')
      .select('id, title, original_filename, privacy_level, doc_type, doc_date, processing_status, ai_summary, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    const { data: fallbackData } = await fallbackQuery
    documents.value = fallbackData ?? []
  } else {
    documents.value = data ?? []
  }

  loading.value = false
}

const fetchCategories = async () => {
  const { data } = await supabase
    .from('categories')
    .select('id, name, parent_id')
    .order('name')
  categories.value = data ?? []
}

onMounted(async () => {
  // Ensure profile is loaded (plugin fires async, may not be ready yet)
  if (!profile.value) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (data && !error) {
        profile.value = data as any
      }
    }
  }
  await Promise.all([fetchDocuments(), fetchCategories()])
})

watch([selectedPrivacy, selectedType, selectedStatus, selectedCategory, selectedSource], fetchDocuments)

// When not in search mode, use DB filtering for the text query
const debouncedFetch = useDebounceFn(fetchDocuments, 300)
watch(searchQuery, () => {
  if (!isSearchMode.value) {
    debouncedFetch()
  }
})

const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
}

function sortIcon(columnId: string) {
  const s = sorting.value.find(s => s.id === columnId)
  if (!s) return 'i-heroicons-arrows-up-down'
  return s.desc ? 'i-heroicons-bars-arrow-down' : 'i-heroicons-bars-arrow-up'
}

const columns: TableColumn<any>[] = [
  {
    accessorKey: 'title',
    header: 'Document',
    enableHiding: false, // always visible
  },
  {
    accessorKey: 'email_from',
    header: 'From',
  },
  {
    accessorKey: 'email_subject',
    header: 'Subject',
  },
  {
    accessorKey: 'privacy_level',
    header: 'Privacy',
  },
  {
    accessorKey: 'sensitivity_tier',
    header: 'Sensitivity',
  },
  {
    accessorKey: 'doc_type',
    header: 'Type',
  },
  {
    accessorKey: 'doc_date',
    header: 'Date',
  },
  {
    accessorKey: 'processing_status',
    header: 'Status',
  },
  {
    accessorKey: 'created_at',
    header: 'Uploaded',
  },
]

// Column visibility toggle items — derived from the table API
const toggleableColumns = computed(() => {
  const api = tableRef.value?.tableApi
  if (!api) return []
  return api.getAllColumns()
    .filter((col: any) => col.getCanHide())
    .map((col: any) => ({
      id: col.id,
      label: columns.find(c => c.accessorKey === col.id)?.header as string ?? col.id,
      visible: col.getIsVisible(),
    }))
})

function toggleColumn(colId: string) {
  const api = tableRef.value?.tableApi
  if (!api) return
  const col = api.getColumn(colId)
  if (col) col.toggleVisibility()
}

// Auto-toggle email columns when source filter changes
watch(selectedSource, (source) => {
  const isEmailFilter = source.startsWith('email')
  columnVisibility.value = {
    ...columnVisibility.value,
    email_from: isEmailFilter,
    email_subject: isEmailFilter,
  }
})

// Dynamic table UI for compact mode
const tableUi = computed(() => {
  if (compact.value) {
    return { th: 'px-2 py-1.5 text-xs', td: 'px-2 py-1' }
  }
  return {}
})

// Display count for subtitle
const displayCount = computed(() => {
  if (isSearchMode.value) return totalHits.value
  return documents.value.length
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Documents</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          {{ displayCount }} {{ isSearchMode ? 'search results' : 'documents' }}
        </p>
      </div>
      <div class="flex gap-2">
        <UButton label="Upload" icon="i-heroicons-arrow-up-tray" to="/documents/upload" />
        <UButton label="Bulk import" icon="i-heroicons-arrow-down-tray" variant="outline" to="/documents/bulk-upload" />
        <UButton label="WhatsApp" icon="i-heroicons-chat-bubble-left-right" variant="outline" to="/documents/import-whatsapp" />
      </div>
    </div>

    <!-- Filters -->
    <UCard class="mb-6">
      <div class="flex flex-wrap gap-3">
        <UInput
          v-model="searchQuery"
          placeholder="Search documents…"
          icon="i-heroicons-magnifying-glass"
          class="flex-1 min-w-48"
        />
        <USelect
          v-model="selectedPrivacy"
          :items="privacyFilterOptions"
          value-key="value"
          class="w-44"
        />
        <USelect
          v-model="selectedType"
          :items="docTypeFilterOptions"
          value-key="value"
          class="w-40"
        />
        <USelect
          v-model="selectedStatus"
          :items="statusFilterOptions"
          value-key="value"
          class="w-40"
        />
        <USelect
          v-model="selectedSource"
          :items="sourceFilterOptions"
          value-key="value"
          class="w-40"
        />
        <USelect
          v-model="selectedCategory"
          :items="categoryFilterOptions"
          value-key="value"
          class="w-52"
        />
      </div>
    </UCard>

    <!-- Search results (Meilisearch mode) -->
    <div v-if="isSearchMode">
      <UCard>
        <div v-if="searching" class="text-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
        </div>

        <div v-else-if="searchResults.length === 0" class="text-center py-12">
          <UIcon name="i-heroicons-magnifying-glass" class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p class="text-gray-500 dark:text-gray-400 text-sm">No results found for "{{ searchQuery }}"</p>
        </div>

        <div v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <NuxtLink
            v-for="hit in searchResults"
            :key="hit.id"
            :to="`/documents/${hit.id}`"
            class="block py-4 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <UIcon
                    v-if="hit.source_channel?.startsWith('email_')"
                    name="i-heroicons-envelope"
                    class="w-4 h-4 text-gray-400 shrink-0"
                  />
                  <h3
                    class="font-medium text-gray-900 dark:text-white truncate"
                    v-html="hit._formatted?.title ?? hit.title"
                  />
                </div>
                <p
                  v-if="hit._formatted?.content"
                  class="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2"
                  v-html="hit._formatted.content"
                />
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <UBadge :color="privacyColors[hit.privacy_level]" variant="soft" size="xs">
                  {{ hit.privacy_level }}
                </UBadge>
                <UBadge
                  v-if="hit.sensitivity_tier"
                  :color="sensitivityColors[hit.sensitivity_tier] ?? 'neutral'"
                  variant="soft"
                  size="xs"
                >
                  {{ sensitivityLabels[hit.sensitivity_tier] ?? hit.sensitivity_tier }}
                </UBadge>
                <span class="text-xs text-gray-400">{{ formatDate(hit.doc_date ?? hit.created_at) }}</span>
              </div>
            </div>
          </NuxtLink>
        </div>
      </UCard>
    </div>

    <!-- Standard document table (DB mode) -->
    <div v-else>
      <UCard>
        <div v-if="loading" class="text-center py-12">
          <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
        </div>

        <div v-else-if="documents.length === 0" class="text-center py-12">
          <UIcon name="i-heroicons-document-text" class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p class="text-gray-500 dark:text-gray-400 text-sm">No documents found.</p>
          <UButton label="Upload the first document" to="/documents/upload" variant="ghost" size="sm" class="mt-2" />
        </div>

        <template v-else>
          <!-- Table toolbar -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <!-- Compact toggle -->
              <UButton
                :icon="compact ? 'i-heroicons-bars-3' : 'i-heroicons-bars-4'"
                :variant="compact ? 'soft' : 'ghost'"
                size="xs"
                :title="compact ? 'Normal rows' : 'Compact rows'"
                @click="compact = !compact"
              />

              <!-- Column visibility dropdown -->
              <UPopover>
                <UButton
                  icon="i-heroicons-view-columns"
                  variant="ghost"
                  size="xs"
                  title="Toggle columns"
                />
                <template #content>
                  <div class="p-2 space-y-1 min-w-40">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400 px-1 mb-2">Columns</p>
                    <label
                      v-for="col in toggleableColumns"
                      :key="col.id"
                      class="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        :checked="col.visible"
                        class="rounded text-primary-500"
                        @change="toggleColumn(col.id)"
                      />
                      <span class="text-sm text-gray-700 dark:text-gray-300">{{ col.label }}</span>
                    </label>
                  </div>
                </template>
              </UPopover>
            </div>
            <span class="text-xs text-gray-400">{{ documents.length }} rows</span>
          </div>

          <UTable
            ref="table"
            :data="documents"
            :columns="columns"
            v-model:sorting="sorting"
            v-model:column-visibility="columnVisibility"
            :ui="tableUi"
          >
            <!-- Sortable headers -->
            <template #title-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Document</span>
                <UIcon :name="sortIcon('title')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #email_from-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>From</span>
                <UIcon :name="sortIcon('email_from')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #email_subject-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Subject</span>
                <UIcon :name="sortIcon('email_subject')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #privacy_level-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Privacy</span>
                <UIcon :name="sortIcon('privacy_level')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #sensitivity_tier-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Sensitivity</span>
                <UIcon :name="sortIcon('sensitivity_tier')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #doc_type-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Type</span>
                <UIcon :name="sortIcon('doc_type')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #doc_date-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Date</span>
                <UIcon :name="sortIcon('doc_date')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #processing_status-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Status</span>
                <UIcon :name="sortIcon('processing_status')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <template #created_at-header="{ column }">
              <button class="flex items-center gap-1 cursor-pointer" @click="column.toggleSorting()">
                <span>Uploaded</span>
                <UIcon :name="sortIcon('created_at')" class="w-3.5 h-3.5 text-gray-400" />
              </button>
            </template>

            <!-- Cell templates -->
            <template #title-cell="{ row }">
              <div class="flex items-center gap-2">
                <UIcon
                  v-if="row.original.source_channel?.startsWith('email_')"
                  name="i-heroicons-envelope"
                  class="w-4 h-4 text-gray-400 shrink-0"
                />
                <div class="min-w-0">
                  <NuxtLink
                    :to="`/documents/${row.original.id}`"
                    class="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    {{ row.original.title || row.original.original_filename || 'Untitled' }}
                  </NuxtLink>
                  <p
                    v-if="row.original.email_context?.subject"
                    class="text-xs text-gray-500 dark:text-gray-400 truncate"
                  >
                    {{ row.original.email_context.subject }}
                  </p>
                </div>
              </div>
            </template>

            <template #email_from-cell="{ row }">
              <span class="text-sm text-gray-500 dark:text-gray-400 truncate">
                {{ row.original.email_context?.sender_name || row.original.email_context?.sender_email || '—' }}
              </span>
            </template>

            <template #email_subject-cell="{ row }">
              <span class="text-sm text-gray-500 dark:text-gray-400 truncate">
                {{ row.original.email_context?.subject || '—' }}
              </span>
            </template>

            <template #privacy_level-cell="{ row }">
              <UBadge
                :color="privacyColors[row.original.privacy_level]"
                variant="soft"
                :size="compact ? 'xs' : 'sm'"
              >
                {{ row.original.privacy_level }}
              </UBadge>
            </template>

            <template #sensitivity_tier-cell="{ row }">
              <UBadge
                v-if="row.original.sensitivity_tier"
                :color="sensitivityColors[row.original.sensitivity_tier] ?? 'neutral'"
                variant="soft"
                :size="compact ? 'xs' : 'sm'"
              >
                {{ sensitivityLabels[row.original.sensitivity_tier] ?? row.original.sensitivity_tier }}
              </UBadge>
              <span v-else class="text-sm text-gray-400">—</span>
            </template>

            <template #doc_type-cell="{ row }">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ row.original.doc_type || '—' }}</span>
            </template>

            <template #doc_date-cell="{ row }">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(row.original.doc_date) }}</span>
            </template>

            <template #processing_status-cell="{ row }">
              <div class="flex items-center gap-1.5">
                <UBadge
                  v-if="isDocStuck(row.original)"
                  color="error"
                  variant="soft"
                  :size="compact ? 'xs' : 'sm'"
                >
                  stuck
                </UBadge>
                <UBadge
                  v-else
                  :color="statusColors[row.original.processing_status] ?? 'neutral'"
                  variant="soft"
                  :size="compact ? 'xs' : 'sm'"
                >
                  {{ row.original.processing_status?.replace(/_/g, ' ') }}
                </UBadge>
                <span v-if="row.original.retry_count > 0" class="text-xs text-gray-400">
                  ({{ row.original.retry_count }}x)
                </span>
                <UButton
                  v-if="isDocStuck(row.original) && isAdmin"
                  icon="i-heroicons-arrow-path"
                  size="xs"
                  variant="ghost"
                  :loading="retryingDocId === row.original.id"
                  title="Retry processing"
                  @click.prevent="retryDocument(row.original.id)"
                />
                <UButton
                  v-if="(isAdmin || row.original.uploaded_by === profile?.id) && (row.original.processing_status === 'failed' || isDocStuck(row.original))"
                  icon="i-heroicons-trash"
                  size="xs"
                  variant="ghost"
                  color="error"
                  :loading="deletingDocId === row.original.id"
                  title="Delete document"
                  @click.prevent="deleteModalDocId = row.original.id"
                />
              </div>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(row.original.created_at) }}</span>
            </template>
          </UTable>
        </template>
      </UCard>
    </div>

    <!-- Delete confirmation modal -->
    <UModal :open="!!deleteModalDocId" @update:open="(v: boolean) => { if (!v) deleteModalDocId = null }">
      <template #content>
        <div class="p-6">
          <div class="flex items-start gap-3 mb-4">
            <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 text-red-500 mt-0.5" />
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Delete document</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Are you sure? This will permanently delete the document and its file. This action cannot be undone.
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              variant="outline"
              @click="deleteModalDocId = null"
            />
            <UButton
              label="Delete"
              color="error"
              icon="i-heroicons-trash"
              :loading="deletingDocId === deleteModalDocId"
              @click="deleteDocument"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
