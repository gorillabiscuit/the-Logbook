/**
 * Document text extraction via Unstructured.io API.
 * Downloads file from Supabase Storage, sends to Unstructured,
 * returns concatenated extracted text.
 */

interface UnstructuredElement {
  type: string
  text: string
  metadata?: Record<string, unknown>
}

/**
 * Downloads a file from Supabase Storage and extracts text using Unstructured.io.
 * Falls back to raw text for plain text files.
 */
export async function extractText(
  fileUrl: string,
  mimeType: string | null
): Promise<string> {
  const supabase = useSupabaseAdmin()

  // Download file from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('documents')
    .download(fileUrl)

  if (downloadError || !fileData) {
    throw new Error(`Failed to download file: ${downloadError?.message ?? 'No data returned'}`)
  }

  // Plain text files don't need Unstructured
  if (mimeType === 'text/plain') {
    return await fileData.text()
  }

  // Send to Unstructured.io API
  const config = useRuntimeConfig()
  const apiKey = config.unstructuredApiKey
  const apiUrl = config.unstructuredApiUrl

  if (!apiKey || !apiUrl) {
    throw new Error('Unstructured API credentials not configured')
  }

  const formData = new FormData()
  formData.append('files', fileData, fileUrl.split('/').pop() ?? 'document')

  const response = await $fetch<UnstructuredElement[]>(apiUrl, {
    method: 'POST',
    headers: {
      'unstructured-api-key': apiKey,
    },
    body: formData,
  })

  if (!response || !Array.isArray(response)) {
    throw new Error('Invalid response from Unstructured API')
  }

  // Concatenate extracted text elements with double newlines for paragraph separation
  const text = response
    .filter(el => el.text && el.text.trim().length > 0)
    .map(el => el.text.trim())
    .join('\n\n')

  if (!text || text.trim().length === 0) {
    throw new Error('No text could be extracted from the document')
  }

  return text
}
