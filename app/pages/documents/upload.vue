<script setup lang="ts">
import { z } from 'zod'

definePageMeta({
  middleware: 'auth',
})

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const toast = useToast()
const router = useRouter()

const schema = z.object({
  title: z.string().min(1, 'Title is required'),
  doc_type: z.string().min(1, 'Document type is required'),
  doc_date: z.string().optional(),
  privacy_level: z.enum(['shared', 'private', 'privileged']),
  category_ids: z.array(z.string()).optional(),
})

type FormState = z.infer<typeof schema>

const state = reactive<FormState>({
  title: '',
  doc_type: '',
  doc_date: '',
  privacy_level: 'shared',
  category_ids: [],
})

const selectedFile = ref<File | null>(null)
const uploading = ref(false)
const categories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])

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

const onFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) {
    selectedFile.value = input.files[0]
    // Pre-fill title from filename if empty
    if (!state.title) {
      state.title = input.files[0].name.replace(/\.[^.]+$/, '')
    }
  }
}

const upload = async () => {
  if (!selectedFile.value) {
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

  try {
    const file = selectedFile.value
    const ext = file.name.split('.').pop()
    const storagePath = `${sessionUser.id}/${Date.now()}.${ext}`

    // Upload to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })

    if (storageError) throw storageError

    // Insert document record
    const { data: doc, error: dbError } = await supabase
      .from('documents')
      .insert({
        uploaded_by: sessionUser.id,
        title: state.title,
        original_filename: file.name,
        file_url: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type,
        privacy_level: state.privacy_level,
        doc_type: state.doc_type || null,
        doc_date: state.doc_date || null,
        source_channel: 'web_upload',
        processing_status: 'pending',
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

    toast.add({ title: 'Document uploaded', description: 'Processing has started automatically.', color: 'success' })
    await router.push(`/documents/${doc.id}`)
  } catch (err: any) {
    toast.add({ title: 'Upload failed', description: err.message, color: 'error' })
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl">
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
      <UForm :schema="schema" :state="state" @submit="upload" class="space-y-5">
        <!-- File picker -->
        <UFormField label="File" name="file" required>
          <div
            class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center hover:border-primary-400 transition-colors cursor-pointer"
            @click="($refs.fileInput as HTMLInputElement).click()"
          >
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt,.eml,.msg"
              @click.stop
              @change="onFileChange"
            />
            <template v-if="selectedFile">
              <UIcon name="i-heroicons-document-check" class="w-8 h-8 text-primary-500 mx-auto mb-2" />
              <p class="text-sm font-medium text-gray-900 dark:text-white">{{ selectedFile.name }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ (selectedFile.size / 1024).toFixed(1) }} KB</p>
            </template>
            <template v-else>
              <UIcon name="i-heroicons-arrow-up-tray" class="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p class="text-sm text-gray-500 dark:text-gray-400">Click to select a file</p>
              <p class="text-xs text-gray-400 mt-0.5">PDF, DOCX, JPG, PNG, TXT, EML</p>
            </template>
          </div>
        </UFormField>

        <!-- Title -->
        <UFormField label="Title" name="title" required>
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

        <!-- Privacy level -->
        <UFormField label="Privacy level" name="privacy_level" required>
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

        <!-- Categories -->
        <UFormField label="Categories" name="category_ids">
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
            label="Upload document"
            icon="i-heroicons-arrow-up-tray"
            :loading="uploading"
          />
        </div>
      </UForm>
    </UCard>
  </div>
</template>
