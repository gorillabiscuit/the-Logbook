<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const supabase = useSupabaseClient()
const toast = useToast()
const router = useRouter()

const categories = ref<Array<{ id: string; name: string; parent_id: string | null }>>([])
const submitting = ref(false)

const severityOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
]

const form = reactive({
  title: '',
  description: '',
  category_id: '',
  severity: 'normal',
  privacy_level: 'shared',
})

onMounted(async () => {
  const { data } = await supabase
    .from('categories')
    .select('id, name, parent_id')
    .order('name')
  categories.value = data ?? []
})

const categoryOptions = computed(() => {
  const parents = categories.value.filter(c => !c.parent_id)
  const result: Array<{ label: string; value: string }> = [{ label: 'None', value: '' }]
  for (const parent of parents) {
    result.push({ label: parent.name, value: parent.id })
    const children = categories.value.filter(c => c.parent_id === parent.id)
    for (const child of children) {
      result.push({ label: `  ${parent.name} > ${child.name}`, value: child.id })
    }
  }
  return result
})

async function submit() {
  if (!form.title.trim()) {
    toast.add({ title: 'Title is required', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const data = await $fetch<{ id: string }>('/api/issues', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body: { ...form, category_id: form.category_id || null },
    })
    toast.add({ title: 'Issue reported', color: 'success' })
    await router.push(`/issues/${data.id}`)
  } catch (err: any) {
    toast.add({ title: 'Failed to report', description: err?.data?.message || err.message, color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl">
    <div class="mb-6">
      <div class="flex items-center gap-2 mb-1">
        <UButton icon="i-heroicons-arrow-left" variant="ghost" size="sm" to="/issues" />
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Report an Issue</h1>
      </div>
      <p class="text-gray-500 dark:text-gray-400 text-sm ml-9">Describe a building issue that needs attention.</p>
    </div>

    <UCard>
      <form @submit.prevent="submit" class="space-y-5">
        <UFormField label="Title" required>
          <UInput v-model="form.title" placeholder="Brief description of the issue" class="w-full" />
        </UFormField>

        <UFormField label="Description">
          <UTextarea v-model="form.description" placeholder="Provide details about the issue..." :rows="5" class="w-full" />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Category">
            <USelect v-model="form.category_id" :items="categoryOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField label="Severity">
            <USelect v-model="form.severity" :items="severityOptions" value-key="value" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Privacy">
          <div class="flex gap-4">
            <label v-for="opt in [{ label: 'Shared', value: 'shared' }, { label: 'Private', value: 'private' }]" :key="opt.value" class="flex items-center gap-2">
              <input type="radio" :value="opt.value" v-model="form.privacy_level" class="text-primary-600" />
              <span class="text-sm">{{ opt.label }}</span>
            </label>
          </div>
        </UFormField>

        <div class="flex justify-end gap-3 pt-2">
          <UButton label="Cancel" variant="ghost" to="/issues" />
          <UButton type="submit" label="Submit issue" icon="i-heroicons-exclamation-triangle" :loading="submitting" />
        </div>
      </form>
    </UCard>
  </div>
</template>
