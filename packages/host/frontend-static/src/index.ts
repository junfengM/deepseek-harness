/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root and configured index
 * path; missing paths return 404, traversal outside the dist root is 403,
 * unknown extensions ship as octet-stream, and non-GET/HEAD is 405. Every
 * index response first passes Connection's browser authentication, then the
 * webserver's index render (structured injection rows, then raw taps).
 * Non-index assets stay public. The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/** One file's served form: strong etag plus lazily-built compressed variants. */
interface EncodedFile {
  readonly plain: Buffer
  readonly etag: string
  gzip?: Buffer
  br?: Buffer
}

/** Memoized per absolute path: compression runs once per server lifetime. */
const encodedFiles = new Map<string, EncodedFile>()

/** Vite content-hashed asset (e.g. /assets/index-ClqxG24t.js): safe to cache forever. */
const HASHED_ASSET = /^\/assets\/.+-[0-9A-Za-z_-]{6,}\.[a-z][a-z0-9.]*$/

/**
 * Build the memoized encoded form of one file: strong etag plus brotli/gzip
 * variants built on first request (brotli at a fast quality — the point is
 * wire size, not maximum ratio) so repeat mobile visits transfer ~4x less.
 */
function encodeFile(target: string, body: string | Buffer): EncodedFile {
  const plain = Buffer.isBuffer(body) ? body : Buffer.from(body)
  let entry = encodedFiles.get(target)
  if (entry === undefined || !entry.plain.equals(plain)) {
    entry = {
      plain,
      etag: `"${createHash('sha1').update(plain).digest('hex')}"`,
      gzip: gzipSync(plain, { level: 6 }),
      br: brotliCompressSync(plain, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }),
    }
    encodedFiles.set(target, entry)
  }
  return entry
}

/**
 * Pick the strongest client-accepted encoding and its token.
 * @returns the variant buffer and content-encoding value, or the plain body with no encoding.
 */
function negotiate(entry: EncodedFile, acceptEncoding: string | undefined): { body: Buffer; encoding?: string } {
  const ae = acceptEncoding ?? ''
  if (entry.br !== undefined && /\bbr\b/i.test(ae)) return { body: entry.br, encoding: 'br' }
  if (entry.gzip !== undefined && /\bgzip\b/i.test(ae)) return { body: entry.gzip, encoding: 'gzip' }
  return { body: entry.plain }
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - authenticates an index response before its bytes are read.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 */
export async function serveStatic(
  pathname: string, req: IncomingMessage, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => boolean,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  try {
    if (target === distRoot || target === distIndex) {
      if (!authorizeIndex()) return
      body = await renderIndex()
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    res.writeHead(404)
    res.end()
    return
  }
  const entry = encodeFile(target, body)
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { etag: entry.etag })
    res.end()
    return
  }
  const acceptEncoding = req.headers['accept-encoding']
  const { body: payload, encoding } = negotiate(
    entry,
    typeof acceptEncoding === 'string' ? acceptEncoding : undefined,
  )
  // Hashed vite filenames are content-addressed → cache forever; everything
  // else (index.html render, favicon, manifest) revalidates via etag.
  const cacheControl = HASHED_ASSET.test(pathname) && target !== distIndex
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  res.writeHead(200, {
    'content-type': type,
    'content-length': payload.length,
    'cache-control': cacheControl,
    etag: entry.etag,
    ...(encoding !== undefined ? { 'content-encoding': encoding } : {}),
    vary: 'Accept-Encoding',
  })
  res.end(req.method === 'HEAD' ? undefined : payload)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  // The dist is built with a relative base so the same files mount under any
  // static directory; served pages also answer deep SPA-fallback paths, where
  // relative asset URLs would resolve under the request directory, so the
  // served form anchors them at the site root ahead of every URL-bearing tag.
  const renderIndex = async (): Promise<string> => {
    const body = ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
    return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
  }
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(
      decodeURIComponent(rawPath),
      req,
      res,
      distRoot,
      distIndex,
      () => ctx.connection.authorizeIndex(req, res),
      renderIndex,
    )
  }), 'frontend-static: fallback seat')
}
