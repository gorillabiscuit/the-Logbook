<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const route = useRoute()
const supabase = useSupabaseClient()
const toast = useToast()
const { hasRole } = useAuth()

const documentId = route.params.id as string
const doc = ref<any>(null)
const categories = ref<any[]>([])
const processingStages = ref<any[]>([])
const loading = ref(true)
const showExtracted = ref(false)
const reprocessing = ref(false)

const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))

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

const stageStatusColors: Record<string, 'neutral' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'warning',
  completed: 'success',
  failed: 'error',
}

const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Africa/Johannesburg',
  })
}

const formatDateTime = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

const fetchDocument = async () => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !data) {
    toast.add({ title: 'Document not found', color: 'error' })
    navigateTo('/documents')
    return
  }

  doc.value = data
}

const fetchCategories = async () => {
  const { data } = await supabase
    .from('document_categories')
    .select(`
      confidence,
      category:categories(id, name, parent_id)
    `)
    .eq('document_id', documentId)

  categories.value = data ?? []
}

const fetchStatus = async () => {
  try {
    const data = await $fetch(`/api/documents/${documentId}/status`)
    processingStages.value = (data as any).stages ?? []
  } catch {
    // Non-critical — status endpoint may not be available yet
  }
}

// Poll for status updates while processing
let pollInterval: ReturnType<typeof setInterval> | null = null

const startPolling = () => {
  if (pollInterval) return
  pollInterval = setInterval(async () => {
    await fetchDocument()
    await fetchStatus()
    if (doc.value && !['pending', 'processing'].includes(doc.value.processing_status)) {
      stopPolling()
      await fetchCategories()
    }
  }, 3000)
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

const reprocess = async () => {
  reprocessing.value = true
  try {
    await $fetch(`/api/documents/${documentId}/reprocess`, { method: 'POST' })
    toast.add({ title: 'Reprocessing started', color: 'info' })
    await fetchDocument()
    startPolling()
  } catch (err: any) {
    toast.add({ title: 'Reprocess failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    reprocessing.value = false
  }
}

const downloadUrl = computed(() => {
  if (!doc.value?.file_url) return null
  const { data } = supabase.storage.from('documents').getPublicUrl(doc.value.file_url)
  return data?.publicUrl ?? null
})

onMounted(async () => {
  await Promise.all([fetchDocument(), fetchCategories(), fetchStatus()])
  loading.value = false

  // Start polling if document is still processing
  if (doc.value && ['pending', 'processing'].includes(doc.value.processing_status)) {
    startPolling()
  }
})

onUnmounted(stopPolling)
</script>

<template>
  <div class="max-w-4xl">
    <!-- Header -->
    <div class="flex items-center gap-2 mb-6">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        size="sm"
        to="/documents"
      />
      <div v-if="!loading && doc" class="flex-1 min-w-0">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white truncate">
          {{ doc.title || doc.original_filename || 'Untitled' }}
        </h1>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
    </div>

    <div v-else-if="doc" class="space-y-6">
      <!-- Metadata card -->
      <UCard>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Privacy</span>
            <UBadge :color="privacyColors[doc.privacy_level]" variant="soft">
              {{ doc.privacy_level }}
            </UBadge>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Status</span>
            <UBadge :color="statusColors[doc.processing_status] ?? 'neutral'" variant="soft">
              {{ doc.processing_status?.replace(/_/g, ' ') }}
            </UBadge>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Type</span>
            <span class="text-gray-900 dark:text-white">{{ doc.doc_type || '—' }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Document date</span>
            <span class="text-gray-900 dark:text-white">{{ formatDate(doc.doc_date) }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">Uploaded</span>
            <span class="text-gray-900 dark:text-white">{{ formatDateTime(doc.created_at) }}</span>
          </div>
          <div>
            <span class="text-gray-500 dark:text-gray-400 block mb-1">File</span>
            <span class="text-gray-900 dark:text-white text-xs">{{ doc.original_filename }}</span>
          </div>
        </div>

        <template #footer>
          <div class="flex gap-2">
            <UButton
              v-if="downloadUrl"
              :to="downloadUrl"
              target="_blank"
              icon="i-heroicons-arrow-down-tray"
              label="Download"
              variant="outline"
              size="sm"
            />
            <UButton
              v-if="isAdmin"
              icon="i-heroicons-arrow-path"
              label="Reprocess"
              variant="outline"
              size="sm"
              :loading="reprocessing"
              @click="reprocess"
            />
          </div>
        </template>
      </UCard>

      <!-- Processing status (shown while processing or on failure) -->
      <UCard v-if="['pending', 'processing'].includes(doc.processing_status)">
        <div class="flex items-center gap-3 mb-4">
          <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 text-primary-500 animate-spin" />
          <span class="font-medium text-gray-900 dark:text-white">Processing document...</span>
        </div>
        <div v-if="processingStages.length" class="space-y-2">
          <div v-for="stage in processingStages" :key="stage.stage" class="flex items-center gap-2 text-sm">
            <UBadge :color="stageStatusColors[stage.status] ?? 'neutral'" variant="soft" size="xs">
              {{ stage.status }}
            </UBadge>
            <span class="text-gray-600 dark:text-gray-300">{{ stage.stage.replace(/_/g, ' ') }}</span>
            <span v-if="stage.error_message" class="text-red-500 text-xs truncate">{{ stage.error_message }}</span>
          </div>
        </div>
      </UCard>

      <!-- Error display -->
      <UCard v-if="doc.processing_error && doc.processing_status === 'failed'" class="border-red-200 dark:border-red-800">
        <div class="flex items-start gap-3">
          <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-500 mt-0.5" />
          <div>
            <p class="font-medium text-red-800 dark:text-red-200 mb-1">Processing failed</p>
            <p class="text-sm text-red-600 dark:text-red-400">{{ doc.processing_error }}</p>
          </div>
        </div>
      </UCard>

      <!-- AI Summary -->
      <UCard v-if="doc.ai_summary">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium text-gray-900 dark:text-white">AI Summary</span>
            <UBadge v-if="doc.ai_confidence" variant="soft" size="xs">
              {{ (doc.ai_confidence * 100).toFixed(0) }}% confidence
            </UBadge>
          </div>
        </template>
        <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ doc.ai_summary }}</p>
      </UCard>

      <!-- Categories -->
      <UCard v-if="categories.length > 0">
        <template #header>
          <span class="font-medium text-gray-900 dark:text-white">Categories</span>
        </template>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="cat in categories"
            :key="cat.category?.id"
            variant="soft"
            color="primary"
          >
            {{ cat.category?.name }}
            <span v-if="cat.confidence" class="ml-1 opacity-60">{{ (cat.confidence * 100).toFixed(0) }}%</span>
          </UBadge>
        </div>
      </UCard>

      <!-- Extracted/Scrubbed text -->
      <UCard v-if="doc.extracted_text || doc.scrubbed_text">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium text-gray-900 dark:text-white">Document text</span>
            <div v-if="doc.extracted_text && doc.scrubbed_text" class="flex gap-1">
              <UButton
                :variant="!showExtracted ? 'solid' : 'outline'"
                size="xs"
                label="Scrubbed"
                @click="showExtracted = false"
              />
              <UButton
                v-if="isAdmin"
                :variant="showExtracted ? 'solid' : 'outline'"
                size="xs"
                label="Original"
                @click="showExtracted = true"
              />
            </div>
          </div>
        </template>
        <div class="max-h-96 overflow-y-auto">
          <pre class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{{ showExtracted ? doc.extracted_text : (doc.scrubbed_text || doc.extracted_text) }}</pre>
        </div>
      </UCard>
    </div>
  </div>
</template>
