/**
 * Stream source downloads through a hash without writing to disk.
 *
 * Each source is fetched with the global Fetch API, redirected as needed, and
 * hashed chunk by chunk. A local AbortController fuses the caller's signal with
 * the per-source timeout; every error names the URL that failed.
 */

import { createHash } from 'node:crypto'

/** Algorithms accepted by `aosc_checksum_source`. */
export const CHECKSUM_ALGORITHMS = new Set(['sha256', 'sha512', 'sha1'])

/** Hard per-source cap: 256 MiB. */
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * @param {object} input
 * @param {string[]} input.urls
 * @param {'sha256'|'sha512'|'sha1'} [input.algorithm]
 * @param {number} [input.timeoutMs] per-source timeout in milliseconds
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ sources: Array<{ url: string, finalUrl: string, algorithm: string,
 *   checksum: string, size: number }>, chksums: string }>}
 */
export async function checksumSources({
  urls,
  algorithm = 'sha256',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
} = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('aosc_checksum_source: urls must be a non-empty array of URLs')
  }
  for (const url of urls) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('aosc_checksum_source: every url must be a non-empty string')
    }
  }
  if (!CHECKSUM_ALGORITHMS.has(algorithm)) {
    throw new Error(
      `aosc_checksum_source: algorithm ${JSON.stringify(algorithm)} is not supported (use sha256, sha512 or sha1)`,
    )
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('aosc_checksum_source: timeoutMs must be a positive number of milliseconds')
  }
  if (signal?.aborted) {
    throw abortError(urls[0], signal.reason)
  }

  /** @type {Array<{ url: string, finalUrl: string, algorithm: string, checksum: string, size: number }>} */
  const results = []
  for (const url of urls) {
    results.push(await checksumOne(url, algorithm, timeoutMs, signal))
  }

  return {
    sources: results,
    chksums: results.map((entry) => `${entry.algorithm}::${entry.checksum}`).join(' '),
  }
}

async function checksumOne(url, algorithm, timeoutMs, signal) {
  if (signal?.aborted) throw abortError(url, signal.reason)

  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('checksum timeout'))
  }, timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`aosc_checksum_source: HTTP ${response.status} ${response.statusText} for ${url}`)
    }

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
      await response.body?.cancel().catch(() => {})
      throw new Error(
        `aosc_checksum_source: ${url} declares ${declared} bytes, above the 256 MiB per-source limit`,
      )
    }
    if (response.body === null) {
      throw new Error(`aosc_checksum_source: ${url} returned an empty response body`)
    }

    const hash = createHash(algorithm)
    let size = 0
    for await (const chunk of response.body) {
      if (signal?.aborted) throw abortError(url, signal.reason)
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > MAX_SOURCE_BYTES) {
        controller.abort(new Error('checksum size limit exceeded'))
        throw new Error(
          `aosc_checksum_source: ${url} exceeds the 256 MiB per-source limit while downloading`,
        )
      }
      hash.update(bytes)
    }

    return {
      url,
      finalUrl: response.url || url,
      algorithm,
      checksum: hash.digest('hex'),
      size,
    }
  } catch (error) {
    if (signal?.aborted) throw abortError(url, signal.reason)
    if (timedOut) {
      throw new Error(`aosc_checksum_source: timed out after ${timeoutMs}ms downloading ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function abortError(url, reason) {
  const detail = reason instanceof Error && reason.message ? `: ${reason.message}` : ''
  return new Error(`aosc_checksum_source: aborted while downloading ${url}${detail}`)
}
