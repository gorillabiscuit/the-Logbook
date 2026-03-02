/**
 * Document text extraction via Unstructured.io API.
 * Downloads file from Supabase Storage, sends to Unstructured,
 * returns concatenated extracted text.
 *
 * Uses split-PDF mode for large PDFs — Unstructured splits per page
 * and processes in parallel, dramatically reducing time for large docs.
 */

interface UnstructuredElement {
  type: string
  text: string
  metadata?: Record<string, unknown>
}

export type ProgressCallback = (progress: number, detail: string) => Promise<void>

/**
 * Retries an async function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 2000
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

/**
 * Downloads a file from Supabase Storage and extracts text using Unstructured.io.
 * Falls back to raw text for plain text files.
 *
 * For PDFs, enables split-PDF mode which processes pages in parallel
 * for dramatically faster extraction of large documents.
 */
export async function extractText(
  fileUrl: string,
  mimeType: string | null,
  onProgress?: ProgressCallback
): Promise<string> {
  const supabase = useSupabaseAdmin()

  await onProgress?.(5, 'Downloading file from storage...')

  // Download file from Supabase Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('documents')
    .download(fileUrl)

  if (downloadError || !fileData) {
    throw new Error(`Failed to download file: ${downloadError?.message ?? 'No data returned'}`)
  }

  // Plain text files don't need Unstructured
  if (mimeType === 'text/plain') {
    await onProgress?.(100, 'Text file read directly')
    return await fileData.text()
  }

  // Send to Unstructured.io API
  const config = useRuntimeConfig()
  const apiKey = config.unstructuredApiKey
  const apiUrl = config.unstructuredApiUrl

  if (!apiKey || !apiUrl) {
    throw new Error('Unstructured API credentials not configured')
  }

  await onProgress?.(15, 'Preparing file for extraction...')

  // Convert Blob to Buffer, then to File for proper multipart encoding
  const arrayBuffer = await fileData.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const filename = fileUrl.split('/').pop() ?? 'document'
  const file = new File([buffer], filename, { type: mimeType ?? 'application/octet-stream' })

  const isPdf = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')

  const formData = new FormData()
  formData.append('files', file)

  // Enable split-PDF for parallel per-page processing of large PDFs
  if (isPdf) {
    formData.append('split_pdf_page', 'true')
    formData.append('split_pdf_concurrency_level', '5')
    formData.append('split_pdf_allow_failed', 'true')
  }

  await onProgress?.(20, isPdf ? 'Sending to processor (split-PDF mode)...' : 'Sending to processor...')

  // Retry with exponential backoff for transient network errors
  const elements = await withRetry(async () => {
    // Use native fetch — $fetch hangs with FormData in Nitro
    const response = await fetch(apiUrl as string, {
      method: 'POST',
      headers: {
        'unstructured-api-key': apiKey as string,
      },
      body: formData,
      signal: AbortSignal.timeout(240000), // 4 minute timeout (fits within Vercel's 5-min limit)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`Unstructured API error (${response.status}): ${errorText}`)
    }

    const result: UnstructuredElement[] = await response.json()

    if (!result || !Array.isArray(result)) {
      throw new Error('Invalid response from Unstructured API')
    }

    return result
  })

  await onProgress?.(90, 'Processing extraction results...')

  // Concatenate extracted text elements with double newlines for paragraph separation
  const text = elements
    .filter(el => el.text && el.text.trim().length > 0)
    .map(el => el.text.trim())
    .join('\n\n')

  if (!text || text.trim().length === 0) {
    throw new Error('No text could be extracted from the document')
  }

  await onProgress?.(100, 'Extraction complete')

  return text
}
