<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  middleware: 'auth',
})

const supabase = useSupabaseClient()
const { query: searchQuery, results: searchResults, totalHits, searching, isSearchMode } = useSearch()

const selectedPrivacy = ref<string>('')
const selectedType = ref<string>('')
const selectedCategory = ref<string>('')
const loading = ref(false)
const documents = ref<any[]>([])
const categories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])

const privacyFilterOptions = [
  { label: 'All privacy', value: '' },
  { label: 'Shared', value: 'shared' },
  { label: 'Private', value: 'private' },
  { label: 'Privileged', value: 'privileged' },
]

const docTypeFilterOptions = [
  { label: 'All types', value: '' },
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

const privacyColors: Record<string, 'success' | 'warning' | 'error'> = {
  shared: 'success',
  private: 'warning',
  privileged: 'error',
}

const statusColors: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'error',
  flagged_for_review: 'warning',
}

// Build category filter options (flat with parent > child format)
const categoryFilterOptions = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  const result: Array<{ label: string; value: string }> = [{ label: 'All categories', value: '' }]

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
    .select('id, title, original_filename, privacy_level, doc_type, doc_date, processing_status, ai_summary, created_at')
    .order('created_at', { ascending: false })

  if (selectedPrivacy.value) query = query.eq('privacy_level', selectedPrivacy.value)
  if (selectedType.value) query = query.eq('doc_type', selectedType.value)

  // Category filter: join through document_categories
  if (selectedCategory.value) {
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

  const { data } = await query.limit(50)
  documents.value = data ?? []
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
  await Promise.all([fetchDocuments(), fetchCategories()])
})

watch([selectedPrivacy, selectedType, selectedCategory], fetchDocuments)

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

const columns: TableColumn<any>[] = [
  {
    accessorKey: 'title',
    header: 'Document',
  },
  {
    accessorKey: 'privacy_level',
    header: 'Privacy',
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

// Display count for subtitle
const displayCount = computed(() => {
  if (isSearchMode.value) return totalHits.value
  return documents.length
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
                <h3
                  class="font-medium text-gray-900 dark:text-white truncate"
                  v-html="hit._formatted?.title ?? hit.title"
                />
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

        <UTable
          v-else
          :data="documents"
          :columns="columns"
        >
          <template #title-cell="{ row }">
            <NuxtLink
              :to="`/documents/${row.original.id}`"
              class="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
            >
              {{ row.original.title || row.original.original_filename || 'Untitled' }}
            </NuxtLink>
          </template>

          <template #privacy_level-cell="{ row }">
            <UBadge
              :color="privacyColors[row.original.privacy_level]"
              variant="soft"
              size="sm"
            >
              {{ row.original.privacy_level }}
            </UBadge>
          </template>

          <template #doc_type-cell="{ row }">
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ row.original.doc_type || '—' }}</span>
          </template>

          <template #doc_date-cell="{ row }">
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(row.original.doc_date) }}</span>
          </template>

          <template #processing_status-cell="{ row }">
            <UBadge
              :color="statusColors[row.original.processing_status] ?? 'neutral'"
              variant="soft"
              size="sm"
            >
              {{ row.original.processing_status?.replace(/_/g, ' ') }}
            </UBadge>
          </template>

          <template #created_at-cell="{ row }">
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ formatDate(row.original.created_at) }}</span>
          </template>
        </UTable>
      </UCard>
    </div>
  </div>
</template>
