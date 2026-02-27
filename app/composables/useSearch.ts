/**
 * Debounced search composable that queries Meilisearch via the server proxy.
 */

interface SearchHit {
  id: string
  title: string
  content?: string
  privacy_level: string
  doc_type: string | null
  doc_date: string | null
  created_at: string
  _formatted?: {
    title?: string
    content?: string
  }
}

interface SearchResult {
  hits: SearchHit[]
  estimatedTotalHits: number
}

export function useSearch() {
  const query = ref('')
  const results = ref<SearchHit[]>([])
  const totalHits = ref(0)
  const searching = ref(false)
  const isSearchMode = computed(() => query.value.trim().length >= 2)

  const performSearch = async () => {
    const q = query.value.trim()

    if (q.length < 2) {
      results.value = []
      totalHits.value = 0
      return
    }

    searching.value = true
    try {
      const data = await $fetch<SearchResult>('/api/search', {
        params: { q },
      })
      results.value = data.hits
      totalHits.value = data.estimatedTotalHits
    } catch {
      results.value = []
      totalHits.value = 0
    } finally {
      searching.value = false
    }
  }

  const debouncedSearch = useDebounceFn(performSearch, 300)
  watch(query, debouncedSearch)

  return {
    query,
    results,
    totalHits,
    searching,
    isSearchMode,
  }
}
