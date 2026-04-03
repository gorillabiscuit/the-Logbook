<script setup lang="ts">
import { z } from 'zod'

definePageMeta({
  middleware: 'auth',
})

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const toast = useToast()
const router = useRouter()

const autoAnalyze = ref(true)
const autoClassifyPrivacy = ref(false)

const schemaManual = z.object({
  title: z.string().min(1, 'Title is required'),
  doc_type: z.string().min(1, 'Document type is required'),
  doc_date: z.string().optional(),
  privacy_level: z.enum(['shared', 'private', 'privileged']),
  category_ids: z.array(z.string()).optional(),
})

const schemaAuto = z.object({
  title: z.string().optional(),
  doc_type: z.string().optional(),
  doc_date: z.string().optional(),
  privacy_level: z.enum(['shared', 'private', 'privileged']),
  category_ids: z.array(z.string()).optional(),
})

const activeSchema = computed(() => {
  if (autoAnalyze.value) return schemaAuto
  // Multi-file manual: title is not required (each file uses its filename)
  if (selectedFiles.value.length > 1) {
    return z.object({
      title: z.string().optional(),
      doc_type: z.string().min(1, 'Document type is required'),
      doc_date: z.string().optional(),
      privacy_level: z.enum(['shared', 'private', 'privileged']),
      category_ids: z.array(z.string()).optional(),
    })
  }
  return schemaManual
})

const state = reactive({
  title: '',
  doc_type: '',
  doc_date: '',
  privacy_level: 'shared' as 'shared' | 'private' | 'privileged',
  category_ids: [] as string[],
})

const selectedFiles = ref<File[]>([])
const uploading = ref(false)
const uploadProgress = ref(0) // tracks how many files have been uploaded so far
const categories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])

// Deduplication
const { computing: hashComputing, computeHash, checkDuplicate } = useFileHash()
const fileHash = ref<string | null>(null)
const duplicateMatch = ref<{ id: string; title: string; created_at: string; privacy_level: string } | null>(null)
const duplicateModalOpen = ref(false)

const docTypeOptions = [
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

const privacyOptions = [
  {
    label: 'Shared',
    value: 'shared',
    description: 'Visible to all authenticated members',
  },
  {
    label: 'Private',
    value: 'private',
    description: 'Visible to you and trustees/lawyer only',
  },
  {
    label: 'Privileged',
    value: 'privileged',
    description: 'Visible to trustees and lawyer only (legal strategy)',
  },
]

// Fetch top-level categories for selection
onMounted(async () => {
  const { data } = await supabase
    .from('categories')
    .select('id, name, parent_id')
    .order('name')

  categories.value = data ?? []
})

// Flat list of categories for display (showing parent > child)
const categoryOptions = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  const result: Array<{ label: string; value: string }> = []

  for (const parent of parents) {
    result.push({ label: parent.name, value: parent.id })
    const children = categories.value.filter(c => c.parent_id === parent.id)
    for (const child of children) {
      result.push({ label: `  ${parent.name} › ${child.name}`, value: child.id })
    }
  }

  return result
})

const dragging = ref(false)

function addFiles(files: File[]) {
  // Deduplicate by name+size against already-selected files
  const existing = new Set(selectedFiles.value.map(f => `${f.name}:${f.size}`))
  const newFiles = files.filter(f => !existing.has(`${f.name}:${f.size}`))
  selectedFiles.value = [...selectedFiles.value, ...newFiles]

  // Auto-fill title only when exactly one file is selected
  if (selectedFiles.value.length === 1 && !state.title) {
    state.title = selectedFiles.value[0].name.replace(/\.[^.]+$/, '')
  }

  // Run duplicate check for single-file selection
  if (selectedFiles.value.length === 1) {
    const file = selectedFiles.value[0]
    fileHash.value = null
    duplicateMatch.value = null
    computeHash(file).then(async (hash) => {
      fileHash.value = hash
      const result = await checkDuplicate(hash)
      if (result.isDuplicate && result.match) {
        duplicateMatch.value = result.match
        duplicateModalOpen.value = true
      }
    }).catch(() => {
      // Non-critical — pipeline catches duplicates server-side
    })
  }
}

function removeFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
  if (selectedFiles.value.length === 0) {
    fileHash.value = null
    duplicateMatch.value = null
  }
}

const onFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    addFiles(Array.from(input.files))
    input.value = '' // reset so the same files can be re-selected
  }
}

const onDrop = (event: DragEvent) => {
  dragging.value = false
  const files = event.dataTransfer?.files
  if (files?.length) {
    addFiles(Array.from(files))
  }
}

async function uploadSingleFile(file: File, sessionUser: { id: string }) {
  const ext = file.name.split('.').pop()
  const storagePath = `${sessionUser.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`

  // Upload to Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (storageError) throw storageError

  // For single file, use the form title; for multi, derive from filename
  const title = selectedFiles.value.length === 1 && state.title
    ? state.title
    : file.name.replace(/\.[^.]+$/, '')

  // Insert document record
  const { data: doc, error: dbError } = await supabase
    .from('documents')
    .insert({
      uploaded_by: sessionUser.id,
      title,
      original_filename: file.name,
      file_url: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
      privacy_level: state.privacy_level,
      doc_type: state.doc_type || null,
      doc_date: state.doc_date || null,
      source_channel: 'web_upload',
      processing_status: 'pending',
      file_hash: selectedFiles.value.length === 1 ? fileHash.value || null : null,
      auto_analyze: autoAnalyze.value,
      auto_classify_privacy: autoClassifyPrivacy.value,
    })
    .select('id')
    .single()

  if (dbError) throw dbError

  // Link categories
  if (state.category_ids?.length && doc) {
    await supabase.from('document_categories').insert(
      state.category_ids.map(catId => ({
        document_id: doc.id,
        category_id: catId,
      }))
    )
  }

  // Trigger document processing pipeline (fire-and-forget)
  if (doc) {
    $fetch(`/api/documents/${doc.id}/process`, { method: 'POST' }).catch(() => {
      // Processing failure is non-blocking — user can retry from detail page
    })
  }

  return doc
}

const upload = async () => {
  if (!selectedFiles.value.length) {
    toast.add({ title: 'Please select a file', color: 'warning' })
    return
  }

  // Get user from session — more reliable than useSupabaseUser() which can be null during hydration
  const { data: { user: sessionUser } } = await supabase.auth.getUser()
  if (!sessionUser) {
    toast.add({ title: 'Not authenticated', color: 'error' })
    return
  }

  uploading.value = true
  uploadProgress.value = 0

  const files = selectedFiles.value
  const failed: string[] = []
  let lastDocId: string | null = null

  try {
    for (const file of files) {
      try {
        const doc = await uploadSingleFile(file, sessionUser)
        if (doc) lastDocId = doc.id
      } catch (err: any) {
        failed.push(file.name)
      }
      uploadProgress.value++
    }

    if (failed.length === files.length) {
      toast.add({ title: 'All uploads failed', color: 'error' })
    } else if (failed.length > 0) {
      toast.add({
        title: `${files.length - failed.length} of ${files.length} uploaded`,
        description: `Failed: ${failed.join(', ')}`,
        color: 'warning',
      })
    } else if (files.length === 1) {
      toast.add({
        title: 'Document uploaded',
        description: autoAnalyze.value
          ? 'AI is analysing, categorising, and naming your document.'
          : 'Processing has started automatically.',
        color: 'success',
      })
    } else {
      toast.add({
        title: `${files.length} documents uploaded`,
        description: autoAnalyze.value
          ? 'AI is analysing, categorising, and naming your documents.'
          : 'Processing has started automatically.',
        color: 'success',
      })
    }

    // Navigate: single file → detail page, multiple → list
    if (files.length === 1 && lastDocId) {
      await router.push(`/documents/${lastDocId}`)
    } else {
      await router.push('/documents')
    }
  } finally {
    uploading.value = false
    uploadProgress.value = 0
  }
}
</script>

<template>
  <div class="w-full">
    <div class="mb-6">
      <div class="flex items-center gap-2 mb-1">
        <UButton
          icon="i-heroicons-arrow-left"
          variant="ghost"
          size="sm"
          to="/documents"
        />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Upload document</h1>
      </div>
      <p class="text-gray-500 dark:text-gray-400 text-sm ml-9">
        Upload a document to the collective knowledge base.
      </p>
    </div>

    <UCard>
      <UForm :schema="activeSchema" :state="state" @submit="upload" class="space-y-5">
        <!-- File picker -->
        <UFormField label="File" name="file" required>
          <div
            class="border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer"
            :class="dragging
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
              : 'border-gray-300 dark:border-gray-700 hover:border-primary-400'"
            @click="($refs.fileInput as HTMLInputElement).click()"
            @dragover.prevent="dragging = true"
            @dragenter.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt,.eml,.msg"
              @click.stop
              @change="onFileChange"
            />
            <template v-if="selectedFiles.length">
              <UIcon name="i-heroicons-document-check" class="w-8 h-8 text-primary-500 mx-auto mb-2" />
              <p v-if="selectedFiles.length === 1" class="text-sm font-medium text-gray-900 dark:text-white">{{ selectedFiles[0].name }}</p>
              <p v-else class="text-sm font-medium text-gray-900 dark:text-white">{{ selectedFiles.length }} files selected</p>
              <p v-if="selectedFiles.length === 1" class="text-xs text-gray-500 mt-0.5">{{ (selectedFiles[0].size / 1024).toFixed(1) }} KB</p>
              <p v-if="hashComputing" class="text-xs text-gray-400 mt-1">Checking for duplicates...</p>
              <p class="text-xs text-primary-500 mt-1">Drop or click to add more files</p>
            </template>
            <template v-else>
              <UIcon name="i-heroicons-arrow-up-tray" class="w-8 h-8 mx-auto mb-2" :class="dragging ? 'text-primary-500' : 'text-gray-400'" />
              <p class="text-sm" :class="dragging ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'">
                {{ dragging ? 'Drop file here' : 'Drag and drop a file here, or click to browse' }}
              </p>
              <p class="text-xs text-gray-400 mt-0.5">PDF, DOCX, JPG, PNG, TXT, EML</p>
            </template>
          </div>
        </UFormField>

        <!-- File list (when multiple files selected) -->
        <div v-if="selectedFiles.length > 1" class="space-y-1">
          <div
            v-for="(file, idx) in selectedFiles"
            :key="`${file.name}-${file.size}`"
            class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/50"
          >
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-heroicons-document-text" class="w-4 h-4 text-gray-400 shrink-0" />
              <span class="text-sm text-gray-700 dark:text-gray-300 truncate">{{ file.name }}</span>
              <span class="text-xs text-gray-400 shrink-0">{{ (file.size / 1024).toFixed(0) }} KB</span>
            </div>
            <UButton
              icon="i-heroicons-x-mark"
              size="xs"
              variant="ghost"
              color="error"
              @click="removeFile(idx)"
            />
          </div>
        </div>

        <!-- Auto-analyse toggle -->
        <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
          :class="autoAnalyze
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950 dark:border-primary-700'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
        >
          <input type="checkbox" v-model="autoAnalyze" class="mt-0.5 text-primary-600 rounded" />
          <div>
            <div class="text-sm font-medium text-gray-900 dark:text-white">Let AI analyse this document</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              AI will read the document and generate a descriptive title, select the document type, and assign categories automatically.
            </div>
          </div>
        </label>

        <!-- Manual metadata fields (collapsed when auto-analyse is on) -->
        <template v-if="!autoAnalyze">
          <!-- Title (only for single file) -->
          <UFormField v-if="selectedFiles.length <= 1" label="Title" name="title" required>
            <UInput v-model="state.title" placeholder="Document title" class="w-full" />
          </UFormField>

          <!-- Doc type & date row -->
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Document type" name="doc_type" required>
              <USelect
                v-model="state.doc_type"
                :items="docTypeOptions"
                value-key="value"
                placeholder="Select type"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Document date" name="doc_date">
              <UInput v-model="state.doc_date" type="date" class="w-full" />
            </UFormField>
          </div>
        </template>

        <template v-else>
          <!-- Minimal fields when auto-analyse is on (title only for single file) -->
          <UFormField v-if="selectedFiles.length <= 1" label="Title (optional — AI will generate one)" name="title">
            <UInput v-model="state.title" placeholder="Leave blank for AI-generated title" class="w-full" />
          </UFormField>
          <p v-if="selectedFiles.length > 1" class="text-xs text-gray-500 dark:text-gray-400">
            Each file will be uploaded as a separate document. AI will generate titles from file contents.
          </p>
        </template>

        <!-- AI privacy classification toggle -->
        <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
          :class="autoClassifyPrivacy
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950 dark:border-primary-700'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
        >
          <input type="checkbox" v-model="autoClassifyPrivacy" class="mt-0.5 text-primary-600 rounded" />
          <div>
            <div class="text-sm font-medium text-gray-900 dark:text-white">Let AI classify privacy level</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              AI will classify this document's privacy level after analysing its contents based on POPIA guidelines.
            </div>
          </div>
        </label>

        <!-- Privacy level (manual selection, hidden when AI classifies) -->
        <UFormField v-if="!autoClassifyPrivacy" label="Privacy level" name="privacy_level" required>
          <div class="space-y-2">
            <label
              v-for="option in privacyOptions"
              :key="option.value"
              class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
              :class="state.privacy_level === option.value
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950 dark:border-primary-700'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
            >
              <input
                type="radio"
                :value="option.value"
                v-model="state.privacy_level"
                class="mt-0.5 text-primary-600"
              />
              <div>
                <div class="text-sm font-medium text-gray-900 dark:text-white">{{ option.label }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">{{ option.description }}</div>
              </div>
            </label>
          </div>
        </UFormField>

        <!-- Note when AI classifies privacy -->
        <div v-if="autoClassifyPrivacy" class="text-xs text-gray-500 dark:text-gray-400 px-1">
          Document will be uploaded as "shared" initially. AI will reclassify the privacy level after analysing the content.
        </div>

        <!-- Categories (hidden when auto-analyse is on) -->
        <UFormField v-if="!autoAnalyze" label="Categories" name="category_ids">
          <div class="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
            <label
              v-for="cat in categoryOptions"
              :key="cat.value"
              class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              <input
                type="checkbox"
                :value="cat.value"
                v-model="state.category_ids"
                class="text-primary-600 rounded"
              />
              <span class="text-sm text-gray-700 dark:text-gray-300">{{ cat.label }}</span>
            </label>
          </div>
          <p class="text-xs text-gray-400 mt-1">Select one or more categories (optional — AI will also suggest categories)</p>
        </UFormField>

        <!-- Submit -->
        <div class="flex justify-end gap-3 pt-2">
          <UButton label="Cancel" variant="ghost" to="/documents" />
          <UButton
            type="submit"
            :label="uploading && selectedFiles.length > 1
              ? `Uploading ${uploadProgress} / ${selectedFiles.length}...`
              : selectedFiles.length > 1
                ? `Upload ${selectedFiles.length} documents`
                : 'Upload document'"
            icon="i-heroicons-arrow-up-tray"
            :loading="uploading"
          />
        </div>
      </UForm>
    </UCard>

    <!-- Duplicate detected modal -->
    <UModal v-model:open="duplicateModalOpen">
      <template #content>
        <div class="p-6">
          <div class="flex items-start gap-3 mb-4">
            <UIcon name="i-heroicons-document-duplicate" class="w-6 h-6 text-amber-500 mt-0.5" />
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Duplicate file detected</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                This file already exists as
                <strong class="text-gray-900 dark:text-white">{{ duplicateMatch?.title || 'Untitled' }}</strong>
                (uploaded {{ duplicateMatch?.created_at ? new Date(duplicateMatch.created_at).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }) : '' }}).
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              variant="outline"
              @click="duplicateModalOpen = false; selectedFiles = []; fileHash = null; duplicateMatch = null"
            />
            <UButton
              label="View existing"
              icon="i-heroicons-eye"
              variant="outline"
              :to="`/documents/${duplicateMatch?.id}`"
            />
            <UButton
              label="Upload anyway"
              icon="i-heroicons-arrow-up-tray"
              @click="duplicateModalOpen = false"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
