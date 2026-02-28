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

  // Convert Blob to Buffer, then to File for proper multipart encoding
  const arrayBuffer = await fileData.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const filename = fileUrl.split('/').pop() ?? 'document'
  const file = new File([buffer], filename, { type: mimeType ?? 'application/octet-stream' })

  const formData = new FormData()
  formData.append('files', file)

  // Use native fetch instead of $fetch — $fetch hangs with FormData in Nitro
  const response = await fetch(apiUrl as string, {
    method: 'POST',
    headers: {
      'unstructured-api-key': apiKey as string,
    },
    body: formData,
    signal: AbortSignal.timeout(300000), // 5 minute timeout for large PDFs
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Unstructured API error (${response.status}): ${errorText}`)
  }

  const elements: UnstructuredElement[] = await response.json()

  if (!elements || !Array.isArray(elements)) {
    throw new Error('Invalid response from Unstructured API')
  }

  // Concatenate extracted text elements with double newlines for paragraph separation
  const text = elements
    .filter(el => el.text && el.text.trim().length > 0)
    .map(el => el.text.trim())
    .join('\n\n')

  if (!text || text.trim().length === 0) {
    throw new Error('No text could be extracted from the document')
  }

  return text
}
