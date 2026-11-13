import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'

import { checksumSources } from '../lib/checksum.js'

const BODY = Buffer.from('hello aosc packaging\n')

async function startServer(t) {
  const server = createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-length': BODY.length })
      response.end(BODY)
      return
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/ok' })
      response.end()
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('streams a source through sha256 and follows redirects', async (t) => {
  const base = await startServer(t)
  const result = await checksumSources({ urls: [`${base}/redirect`] })
  const expected = createHash('sha256').update(BODY).digest('hex')

  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].algorithm, 'sha256')
  assert.equal(result.sources[0].checksum, expected)
  assert.equal(result.sources[0].size, BODY.length)
  assert.equal(result.sources[0].url, `${base}/redirect`)
  assert.equal(result.sources[0].finalUrl, `${base}/ok`)
  assert.equal(result.chksums, `sha256::${expected}`)
})

test('computes sha512 when requested', async (t) => {
  const base = await startServer(t)
  const result = await checksumSources({ urls: [`${base}/ok`], algorithm: 'sha512' })
  const expected = createHash('sha512').update(BODY).digest('hex')

  assert.equal(result.sources[0].checksum, expected)
  assert.equal(result.chksums, `sha512::${expected}`)
})

test('rejects a non-2xx response with the URL in the message', async (t) => {
  const base = await startServer(t)
  await assert.rejects(
    () => checksumSources({ urls: [`${base}/missing`] }),
    (error) => error.message.includes('HTTP 404') && error.message.includes(`${base}/missing`),
  )
})

test('rejects a declared size above the 256 MiB cap before downloading', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-length': 300 * 1024 * 1024 })
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  await assert.rejects(
    () => checksumSources({ urls: [`${base}/huge`] }),
    (error) => /256 MiB/.test(error.message),
  )
})

test('honours an already-aborted signal', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => checksumSources({ urls: ['http://127.0.0.1:9/never'], signal: controller.signal }),
    (error) => /aborted/i.test(error.message),
  )
})

test('times out a stalled source', async (t) => {
  const server = createServer(() => {
    // Intentionally never respond.
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  await assert.rejects(
    () => checksumSources({ urls: [`${base}/stall`], timeoutMs: 100 }),
    (error) => /timed out after 100ms/.test(error.message),
  )
})
