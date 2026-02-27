<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const supabase = useSupabaseClient()
const toast = useToast()
const { hasRole } = useAuth()

const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))
const flaggedDocs = ref<any[]>([])
const allCategories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])
const loading = ref(true)

// Track selected categories per document
const selectedCategories = ref<Record<string, string[]>>({})
const approving = ref<Record<string, boolean>>({})

// Flat list of categories for display
const categoryOptions = computed(() => {
  const parents = allCategories.value.filter(c => !c.parent_id)
  const result: Array<{ label: string; value: string }> = []

  for (const parent of parents) {
    result.push({ label: parent.name, value: parent.id })
    const children = allCategories.value.filter(c => c.parent_id === parent.id)
    for (const child of children) {
      result.push({ label: `  ${parent.name} › ${child.name}`, value: child.id })
    }
  }

  return result
})

const fetchFlagged = async () => {
  loading.value = true
  try {
    const data = await $fetch<any[]>('/api/admin/flagged')
    flaggedDocs.value = data

    // Initialize selected categories from AI suggestions
    for (const doc of data) {
      selectedCategories.value[doc.id] = (doc.suggestedCategories ?? [])
        .map((c: any) => c.category?.id)
        .filter(Boolean)
    }
  } catch (err: any) {
    toast.add({ title: 'Failed to load flagged documents', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

const fetchCategories = async () => {
  const { data } = await supabase
    .from('categories')
    .select('id, name, parent_id')
    .order('name')
  allCategories.value = data ?? []
}

const approve = async (docId: string) => {
  approving.value[docId] = true
  try {
    await $fetch(`/api/admin/flagged/${docId}/approve`, {
      method: 'POST',
      body: { categoryIds: selectedCategories.value[docId] ?? [] },
    })
    toast.add({ title: 'Document approved', color: 'success' })
    flaggedDocs.value = flaggedDocs.value.filter(d => d.id !== docId)
  } catch (err: any) {
    toast.add({ title: 'Approval failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    approving.value[docId] = false
  }
}

onMounted(async () => {
  await Promise.all([fetchFlagged(), fetchCategories()])
})
</script>

<template>
  <div class="max-w-4xl">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Flagged documents</h1>
      <p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
        Documents with low AI categorization confidence that need human review.
      </p>
    </div>

    <div v-if="!isAdmin" class="text-center py-12">
      <p class="text-gray-500">Admin access required.</p>
    </div>

    <div v-else-if="loading" class="text-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
    </div>

    <div v-else-if="flaggedDocs.length === 0" class="text-center py-12">
      <UIcon name="i-heroicons-check-circle" class="w-10 h-10 text-green-400 mx-auto mb-3" />
      <p class="text-gray-500 dark:text-gray-400">No documents need review.</p>
    </div>

    <div v-else class="space-y-4">
      <UCard v-for="doc in flaggedDocs" :key="doc.id">
        <div class="space-y-4">
          <!-- Document header -->
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <NuxtLink
                :to="`/documents/${doc.id}`"
                class="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
              >
                {{ doc.title || doc.original_filename || 'Untitled' }}
              </NuxtLink>
              <p class="text-xs text-gray-400 mt-0.5">
                Confidence: {{ doc.ai_confidence ? (doc.ai_confidence * 100).toFixed(0) + '%' : 'unknown' }}
              </p>
            </div>
            <UBadge color="warning" variant="soft" size="sm">needs review</UBadge>
          </div>

          <!-- AI Summary -->
          <p v-if="doc.ai_summary" class="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded p-3">
            {{ doc.ai_summary }}
          </p>

          <!-- AI suggested categories -->
          <div v-if="doc.suggestedCategories?.length" class="text-sm">
            <span class="text-gray-500 dark:text-gray-400">AI suggested: </span>
            <UBadge
              v-for="cat in doc.suggestedCategories"
              :key="cat.category?.id"
              variant="outline"
              size="xs"
              class="mr-1"
            >
              {{ cat.category?.name }}
              <span v-if="cat.confidence" class="ml-1 opacity-60">{{ (cat.confidence * 100).toFixed(0) }}%</span>
            </UBadge>
          </div>

          <!-- Category selection -->
          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">Assign categories</label>
            <div class="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
              <label
                v-for="cat in categoryOptions"
                :key="cat.value"
                class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  :value="cat.value"
                  v-model="selectedCategories[doc.id]"
                  class="text-primary-600 rounded"
                />
                <span class="text-sm text-gray-700 dark:text-gray-300">{{ cat.label }}</span>
              </label>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-2 pt-2">
            <UButton
              label="Approve"
              icon="i-heroicons-check"
              size="sm"
              :loading="approving[doc.id]"
              @click="approve(doc.id)"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
