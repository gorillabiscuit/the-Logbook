/**
 * Pure text splitting logic for RAG chunking.
 * No external dependencies — splits text into overlapping chunks
 * suitable for embedding and semantic search.
 */

export interface ChunkOptions {
  /** Target chunk size in characters */
  chunkSize?: number
  /** Overlap between consecutive chunks in characters */
  chunkOverlap?: number
}

export interface TextChunk {
  content: string
  chunkIndex: number
  metadata: {
    charStart: number
    charEnd: number
  }
}

const DEFAULT_CHUNK_SIZE = 1000
const DEFAULT_CHUNK_OVERLAP = 200

/**
 * Splits text into overlapping chunks, preferring to break at paragraph
 * and sentence boundaries for better semantic coherence.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

  if (!text || text.trim().length === 0) return []

  // Split into paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)

  const chunks: TextChunk[] = []
  let currentChunk = ''
  let currentStart = 0
  let charPosition = 0

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim()

    // If a single paragraph exceeds chunk size, split it by sentences
    if (trimmedPara.length > chunkSize) {
      // Flush current buffer first
      if (currentChunk.trim().length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunks.length,
          metadata: {
            charStart: currentStart,
            charEnd: currentStart + currentChunk.trim().length,
          },
        })
        // Overlap: keep the tail of the current chunk
        const overlapText = currentChunk.trim().slice(-chunkOverlap)
        currentChunk = overlapText + '\n\n'
        currentStart = currentStart + currentChunk.trim().length - overlapText.length
      }

      // Split long paragraph by sentences
      const sentences = splitSentences(trimmedPara)
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > chunkSize && currentChunk.trim().length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunks.length,
            metadata: {
              charStart: currentStart,
              charEnd: currentStart + currentChunk.trim().length,
            },
          })
          const overlapText = currentChunk.trim().slice(-chunkOverlap)
          currentStart = currentStart + currentChunk.trim().length - overlapText.length
          currentChunk = overlapText + ' '
        }
        currentChunk += sentence + ' '
      }
    } else if (currentChunk.length + trimmedPara.length + 2 > chunkSize && currentChunk.trim().length > 0) {
      // Adding this paragraph would exceed chunk size — flush
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunks.length,
        metadata: {
          charStart: currentStart,
          charEnd: currentStart + currentChunk.trim().length,
        },
      })
      const overlapText = currentChunk.trim().slice(-chunkOverlap)
      currentStart = currentStart + currentChunk.trim().length - overlapText.length
      currentChunk = overlapText + '\n\n' + trimmedPara
    } else {
      // Append paragraph to current chunk
      if (currentChunk.length > 0) {
        currentChunk += '\n\n'
      }
      if (currentChunk.length === 0) {
        currentStart = charPosition
      }
      currentChunk += trimmedPara
    }

    charPosition += paragraph.length + 2 // +2 for the paragraph separator
  }

  // Flush remaining text
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      chunkIndex: chunks.length,
      metadata: {
        charStart: currentStart,
        charEnd: currentStart + currentChunk.trim().length,
      },
    })
  }

  return chunks
}

/**
 * Simple sentence splitter that handles common abbreviations.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space + uppercase letter
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/)
  return parts.filter(s => s.trim().length > 0)
}
