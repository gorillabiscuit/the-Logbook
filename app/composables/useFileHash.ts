/**
 * Browser-side SHA-256 file hashing via Web Crypto API.
 * Used for pre-upload duplicate detection.
 */
export function useFileHash() {
  const computing = ref(false)

  /**
   * Computes SHA-256 hex hash of a File object using Web Crypto API.
   */
  async function computeHash(file: File): Promise<string> {
    computing.value = true
    try {
      const buffer = await file.arrayBuffer()
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    } finally {
      computing.value = false
    }
  }

  /**
   * Checks if a file hash matches an existing document.
   */
  async function checkDuplicate(fileHash: string): Promise<{
    isDuplicate: boolean
    match?: { id: string; title: string; created_at: string; privacy_level: string }
  }> {
    return $fetch('/api/documents/check-hash', {
      method: 'POST',
      body: { file_hash: fileHash },
    }) as any
  }

  return { computing, computeHash, checkDuplicate }
}
