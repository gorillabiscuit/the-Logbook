<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const supabase = useSupabaseClient()
const toast = useToast()
const { hasRole } = useAuth()

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}` }
}

const isAdmin = computed(() => hasRole(['super_admin', 'trustee']))

interface UsageRow {
  operation: string
  service: string
  total_input_tokens: number
  total_output_tokens: number
  total_cost_usd: number
  call_count: number
}

const loading = ref(true)
const isAdminResponse = ref(false)
const allTime = ref<UsageRow[]>([])
const thisMonth = ref<UsageRow[]>([])

const OPERATION_LABELS: Record<string, string> = {
  categorization: 'Categorization',
  pii_scrub: 'PII Scrubbing',
  entity_extraction: 'Entity Extraction',
  chat: 'Chat (RAG)',
  email_triage: 'Email Triage',
  embedding: 'Embeddings',
  query_embedding: 'Query Embedding',
}

const SERVICE_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  voyage: 'Voyage AI',
}

function formatTokens(n: number): string {
  return Number(n).toLocaleString()
}

function formatCost(n: number, decimals = 4): string {
  return `$${Number(n).toFixed(decimals)}`
}

function totalCost(rows: UsageRow[]): number {
  return rows.reduce((sum, r) => sum + Number(r.total_cost_usd), 0)
}

function totalCalls(rows: UsageRow[]): number {
  return rows.reduce((sum, r) => sum + Number(r.call_count), 0)
}

const backfilling = ref(false)

const runBackfill = async () => {
  backfilling.value = true
  try {
    const headers = await getAuthHeaders()
    const result = await $fetch<{
      inserted: number
      estimatedTotalCost: string
      documents: number
      chatMessages: number
      breakdown: Record<string, number>
    }>('/api/admin/backfill-usage', {
      method: 'POST',
      headers,
      body: { days: 10, force: true },
    })
    toast.add({
      title: 'Backfill complete',
      description: `Inserted ${result.inserted} estimated rows (${result.documents} docs, ${result.chatMessages} chats). Est. total: ${result.estimatedTotalCost}`,
      color: 'success',
    })
    await fetchUsage()
  } catch (err: any) {
    toast.add({ title: 'Backfill failed', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    backfilling.value = false
  }
}

const fetchUsage = async () => {
  loading.value = true
  try {
    const headers = await getAuthHeaders()
    const data = await $fetch<{
      isAdmin: boolean
      allTime: UsageRow[]
      thisMonth: UsageRow[]
    }>('/api/usage/summary', { headers })

    isAdminResponse.value = data.isAdmin
    allTime.value = data.allTime
    thisMonth.value = data.thisMonth
  } catch (err: any) {
    toast.add({ title: 'Failed to load usage data', description: err.data?.message ?? err.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(fetchUsage)
</script>

<template>
  <div class="max-w-5xl">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">API Usage</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          {{ isAdminResponse ? 'Token consumption and estimated costs across all AI operations.' : 'Your personal AI chat usage.' }}
        </p>
      </div>
      <UButton
        v-if="isAdmin"
        label="Backfill (10d)"
        icon="i-heroicons-arrow-path"
        variant="outline"
        size="sm"
        :loading="backfilling"
        @click="runBackfill"
      />
    </div>

    <div v-if="loading" class="text-center py-12">
      <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 text-gray-400 mx-auto animate-spin" />
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <UCard>
          <div class="text-sm text-gray-500 dark:text-gray-400">This Month Cost</div>
          <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {{ formatCost(totalCost(thisMonth), 2) }}
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-gray-500 dark:text-gray-400">All-Time Cost</div>
          <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {{ formatCost(totalCost(allTime), 2) }}
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-gray-500 dark:text-gray-400">This Month Calls</div>
          <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {{ totalCalls(thisMonth).toLocaleString() }}
          </div>
        </UCard>
        <UCard>
          <div class="text-sm text-gray-500 dark:text-gray-400">All-Time Calls</div>
          <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {{ totalCalls(allTime).toLocaleString() }}
          </div>
        </UCard>
      </div>

      <!-- This Month breakdown -->
      <div v-if="thisMonth.length > 0" class="mb-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">This Month</h2>
        <UCard>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th class="pb-2 font-medium">Operation</th>
                  <th class="pb-2 font-medium">Service</th>
                  <th class="pb-2 font-medium text-right">API Calls</th>
                  <th class="pb-2 font-medium text-right">Input Tokens</th>
                  <th class="pb-2 font-medium text-right">Output Tokens</th>
                  <th class="pb-2 font-medium text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="row in thisMonth" :key="`${row.operation}-${row.service}`" class="text-gray-700 dark:text-gray-300">
                  <td class="py-2">{{ OPERATION_LABELS[row.operation] || row.operation }}</td>
                  <td class="py-2">{{ SERVICE_LABELS[row.service] || row.service }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.call_count) }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.total_input_tokens) }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.total_output_tokens) }}</td>
                  <td class="py-2 text-right tabular-nums font-medium">{{ formatCost(row.total_cost_usd) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="font-semibold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700">
                  <td class="pt-2" colspan="2">Total</td>
                  <td class="pt-2 text-right tabular-nums">{{ totalCalls(thisMonth).toLocaleString() }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatTokens(thisMonth.reduce((s, r) => s + Number(r.total_input_tokens), 0)) }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatTokens(thisMonth.reduce((s, r) => s + Number(r.total_output_tokens), 0)) }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatCost(totalCost(thisMonth)) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>
      </div>

      <!-- All Time breakdown -->
      <div v-if="allTime.length > 0" class="mb-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-3">All Time</h2>
        <UCard>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th class="pb-2 font-medium">Operation</th>
                  <th class="pb-2 font-medium">Service</th>
                  <th class="pb-2 font-medium text-right">API Calls</th>
                  <th class="pb-2 font-medium text-right">Input Tokens</th>
                  <th class="pb-2 font-medium text-right">Output Tokens</th>
                  <th class="pb-2 font-medium text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="row in allTime" :key="`${row.operation}-${row.service}`" class="text-gray-700 dark:text-gray-300">
                  <td class="py-2">{{ OPERATION_LABELS[row.operation] || row.operation }}</td>
                  <td class="py-2">{{ SERVICE_LABELS[row.service] || row.service }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.call_count) }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.total_input_tokens) }}</td>
                  <td class="py-2 text-right tabular-nums">{{ formatTokens(row.total_output_tokens) }}</td>
                  <td class="py-2 text-right tabular-nums font-medium">{{ formatCost(row.total_cost_usd) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="font-semibold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700">
                  <td class="pt-2" colspan="2">Total</td>
                  <td class="pt-2 text-right tabular-nums">{{ totalCalls(allTime).toLocaleString() }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatTokens(allTime.reduce((s, r) => s + Number(r.total_input_tokens), 0)) }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatTokens(allTime.reduce((s, r) => s + Number(r.total_output_tokens), 0)) }}</td>
                  <td class="pt-2 text-right tabular-nums">{{ formatCost(totalCost(allTime)) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </UCard>
      </div>

      <!-- Empty state -->
      <div v-if="allTime.length === 0 && thisMonth.length === 0" class="text-center py-12">
        <UIcon name="i-heroicons-chart-bar" class="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p class="text-gray-500 dark:text-gray-400">No API usage recorded yet.</p>
      </div>
    </template>
  </div>
</template>
