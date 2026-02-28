<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const toast = useToast()
const router = useRouter()

const files = ref<File[]>([])
const privacyLevel = ref('shared')
const docType = ref('auto')
const uploading = ref(false)
const progress = ref(0)
const results = ref<Array<{ filename: string; status: string; id?: string }>>([])

const privacyOptions = [
  { label: 'Shared', value: 'shared' },
  { label: 'Private', value: 'private' },
  { label: 'Privileged', value: 'privileged' },
]

const docTypeOptions = [
  { label: 'Auto-detect', value: 'auto' },
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

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

function onFilesChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    files.value = Array.from(input.files)
  }
}

function removeFile(index: number) {
  files.value.splice(index, 1)
}

async function uploadAll() {
  if (files.value.length === 0) {
    toast.add({ title: 'No files selected', color: 'warning' })
    return
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    toast.add({ title: 'Not authenticated', color: 'error' })
    return
  }

  uploading.value = true
  progress.value = 0
  results.value = []

  const uploadedDocs: Array<{
    file_url: string
    original_filename: string
    file_size_bytes: number
    mime_type: string
    title: string
    doc_type: string
    privacy_level: string
  }> = []

  // Step 1: Upload all files to storage
  for (let i = 0; i < files.value.length; i++) {
    const file = files.value[i]
    const ext = file.name.split('.').pop()
    const storagePath = `${user.id}/${Date.now()}-${i}.${ext}`

    try {
      const { error } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        })

      if (error) {
        results.value.push({ filename: file.name, status: `upload failed: ${error.message}` })
        continue
      }

      uploadedDocs.push({
        file_url: storagePath,
        original_filename: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        title: file.name.replace(/\.[^.]+$/, ''),
        doc_type: docType.value === 'auto' ? '' : docType.value,
        privacy_level: privacyLevel.value,
      })
    } catch (err: any) {
      results.value.push({ filename: file.name, status: `error: ${err.message}` })
    }

    progress.value = Math.round(((i + 1) / files.value.length) * 50)
  }

  // Step 2: Create records and trigger processing via bulk endpoint
  if (uploadedDocs.length > 0) {
    try {
      const headers = await getAuthHeaders()
      const response = await $fetch<any>('/api/documents/bulk-upload', {
        method: 'POST',
        headers,
        body: { documents: uploadedDocs },
      })

      for (const r of response.results) {
        results.value.push({ filename: r.filename, status: r.status, id: r.id })
      }
    } catch (err: any) {
      toast.add({ title: 'Bulk processing failed', description: err?.data?.message || err.message, color: 'error' })
    }
  }

  progress.value = 100
  uploading.value = false

  const successCount = results.value.filter(r => r.status === 'pending').length
  if (successCount > 0) {
    toast.add({ title: `${successCount} document(s) uploaded`, description: 'Processing has started.', color: 'success' })
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
</script>

<template>
  <div class="max-w-3xl">
    <div class="flex items-center gap-2 mb-6">
      <UButton icon="i-heroicons-arrow-left" variant="ghost" size="sm" to="/documents" />
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Bulk Upload</h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload multiple documents at once for historical import</p>
      </div>
    </div>

    <UCard class="mb-6">
      <div class="space-y-5">
        <!-- File picker -->
        <div
          class="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center hover:border-primary-400 transition-colors cursor-pointer"
          @click="($refs.fileInput as HTMLInputElement).click()"
        >
          <input
            ref="fileInput"
            type="file"
            class="hidden"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt,.eml,.msg"
            multiple
            @click.stop
            @change="onFilesChange"
          />
          <UIcon name="i-heroicons-arrow-up-tray" class="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p class="text-sm text-gray-500 dark:text-gray-400">Click to select files (max 50)</p>
          <p class="text-xs text-gray-400 mt-1">PDF, DOCX, JPG, PNG, TXT, EML</p>
        </div>

        <!-- Selected files -->
        <div v-if="files.length > 0" class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ files.length }} file(s) selected</span>
            <UButton label="Clear all" variant="ghost" size="xs" @click="files = []" />
          </div>
          <div class="max-h-48 overflow-y-auto space-y-1">
            <div
              v-for="(file, i) in files"
              :key="i"
              class="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded"
            >
              <div class="min-w-0 flex-1">
                <span class="text-sm text-gray-700 dark:text-gray-300 truncate block">{{ file.name }}</span>
                <span class="text-xs text-gray-400">{{ formatSize(file.size) }}</span>
              </div>
              <UButton icon="i-heroicons-x-mark" variant="ghost" size="xs" @click="removeFile(i)" />
            </div>
          </div>
        </div>

        <!-- Options -->
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Privacy level">
            <USelect v-model="privacyLevel" :items="privacyOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Document type">
            <USelect v-model="docType" :items="docTypeOptions" value-key="value" class="w-full" />
          </UFormField>
        </div>

        <!-- Upload button -->
        <div class="flex justify-end gap-3">
          <UButton label="Cancel" variant="ghost" to="/documents" />
          <UButton
            label="Upload all"
            icon="i-heroicons-arrow-up-tray"
            :loading="uploading"
            :disabled="files.length === 0"
            @click="uploadAll"
          />
        </div>

        <!-- Progress -->
        <div v-if="uploading" class="space-y-2">
          <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-primary-500 transition-all duration-300"
              :style="{ width: `${progress}%` }"
            />
          </div>
          <p class="text-xs text-gray-500 text-center">{{ progress }}% complete</p>
        </div>
      </div>
    </UCard>

    <!-- Results -->
    <UCard v-if="results.length > 0">
      <h2 class="text-sm font-semibold text-gray-900 dark:text-white mb-3">Results</h2>
      <div class="space-y-1">
        <div
          v-for="(r, i) in results"
          :key="i"
          class="flex items-center justify-between gap-3 py-1.5 text-sm"
        >
          <span class="text-gray-700 dark:text-gray-300 truncate">{{ r.filename }}</span>
          <div class="flex items-center gap-2 flex-shrink-0">
            <UBadge
              :color="r.status === 'pending' ? 'success' : 'error'"
              variant="subtle"
              size="xs"
            >
              {{ r.status === 'pending' ? 'processing' : r.status }}
            </UBadge>
            <NuxtLink v-if="r.id" :to="`/documents/${r.id}`">
              <UButton icon="i-heroicons-arrow-right" variant="ghost" size="xs" />
            </NuxtLink>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
