/**
 * 常凯申插件 —— Host 半。
 *
 * 只做三件事：
 *  1. 读取本机 DSH 已有的 DeepSeek 凭据/账号，查余额（不存密钥、不写文件）；
 *  2. 给挂件提供同源 HTTP 接口（余额、素材）；
 *  3. 提供自检信息。
 *
 * 终极大乱的“像素打乱”在页面内完成（DOM 抓图），不经过系统截屏；
 * 不包含任何“混淆/隐藏图片”能力。
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const PREFIX = '/dsh-chang-kaishen'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_TTL_MS = 60_000
const ACCOUNT_FALLBACK_MS = 5_000

const ASSETS = new Map([
  ['qban-cutout.png', 'image/png'],
  ['gold-yuan-front.png', 'image/png'],
  ['target-meme.png', 'image/png'],
  ['target-meme-weights.png', 'image/png'],
  ['reward-qr.png', 'image/png'],
  ['html2canvas.min.js', 'text/javascript; charset=utf-8'],
])

export const inject = ['webServer']

export function apply(ctx) {
  let balanceCache = null // { at: number, value: object }

  console.log('[chang-kaishen] host applied')

  const routes = []
  const register = (kind, path, handler) => {
    const dispose = ctx.webServer.register({ kind, path, handler })
    routes.push(dispose)
    return dispose
  }

  ctx.effect(() => {
    // ---- 余额 ----
    register('exact', `${PREFIX}/balance.json`, async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const force = url.searchParams.get('refresh') === '1'
        const now = Date.now()
        if (!force && balanceCache && now - balanceCache.at < BALANCE_TTL_MS) {
          return sendJson(res, 200, balanceCache.value)
        }
        const value = await fetchBalance(ctx)
        if (value.ok) balanceCache = { at: now, value }
        else if (balanceCache) {
          return sendJson(res, 200, { ...balanceCache.value, stale: true, error: value.error })
        }
        sendJson(res, 200, value)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: shortError(err) })
      }
    })

    // ---- 素材 ----
    for (const [name, type] of ASSETS) {
      register('exact', `${PREFIX}/assets/${name}`, async (req, res) => {
        try {
          const body = await fs.readFile(join(PACKAGE_ROOT, 'assets', name))
          res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': body.length,
            'Cache-Control': 'public, max-age=3600',
          })
          res.end(body)
        } catch (err) {
          sendJson(res, 404, { ok: false, error: shortError(err) })
        }
      })
    }

    // ---- 当前屏幕截图（大乱源图；DSH 窗口受内容保护时抓到的就是桌面） ----
    register('exact', `${PREFIX}/screen.png`, async (req, res) => {
      const file = join(tmpdir(), `dsh-chang-kaishen-screen-${process.pid}-${Date.now()}.png`)
      try {
        if (process.platform !== 'darwin') throw new Error('screen capture only supported on macOS')
        await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', file], { timeout: 10000 })
        const body = await fs.readFile(file)
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        })
        res.end(body)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: shortError(err) })
      } finally {
        await fs.unlink(file).catch(() => {})
      }
    })

    // ---- 自检 ----
    register('exact', `${PREFIX}/health.json`, async (req, res) => {
      sendJson(res, 200, {
        ok: true,
        name: 'dsh-chang-kaishen',
        version: '0.1.0',
        platform: process.platform,
        routes: routes.length,
      })
    })

    return () => {
      for (const dispose of routes.splice(0)) {
        try {
          dispose()
        } catch {}
      }
    }
  })
}

// ---------------------------------------------------------------------------
// 余额
// ---------------------------------------------------------------------------

async function fetchBalance(ctx) {
  // 1) DSH 凭据里的 DeepSeek API Key
  let key = null
  let keyError = null
  const credentials = safeGet(ctx, 'credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cred = await credentials.resolve('DEEPSEEK_API_KEY')
        key = cred && typeof cred.value === 'string' ? cred.value : null
        keyError = null
        break
      } catch (err) {
        keyError = err
        if (attempt === 0) await delay(500)
      }
    }
  }

  if (key) {
    const api = await fetchApiKeyBalance(key)
    if (api.ok) return api
    const account = await fetchAccountBalance(ctx)
    if (account.ok) return { ...account, via: 'account' }
    return {
      ok: false,
      error: `API Key 路：${api.error}；账号路：${account.error || '不可用'}`,
    }
  }

  // 2) DSH 账号登录态（只登录客户端、没有 API Key 的用户）
  const account = await fetchAccountBalance(ctx)
  if (account.ok) return { ...account, via: 'account' }
  return {
    ok: false,
    error:
      (keyError ? `凭据读取失败：${shortError(keyError)}；` : '未配置 DEEPSEEK_API_KEY；') +
      `账号路：${account.error || '不可用'}`,
  }
}

async function fetchApiKeyBalance(key) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`)
        if (res.status < 500) break
        if (attempt === 0) await delay(400)
        continue
      }
      const data = await res.json()
      const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
      const info =
        infos.find((item) => String(item?.currency || '').toUpperCase() === 'CNY') || infos[0]
      const cny = Number(info?.total_balance)
      if (!Number.isFinite(cny)) {
        return { ok: false, error: '余额接口返回结构异常' }
      }
      return {
        ok: true,
        cny,
        currency: String(info?.currency || 'CNY').toUpperCase(),
        source: 'api-key',
        at: Date.now(),
      }
    } catch (err) {
      lastError = err
      if (attempt === 0) await delay(400)
    }
  }
  return { ok: false, error: `余额接口请求失败：${shortError(lastError)}` }
}

async function fetchAccountBalance(ctx) {
  const account = safeGet(ctx, 'deepseekAccount')
  if (!account || typeof account.getBalance !== 'function') {
    return { ok: false, error: '当前 DSH 没有可用的账号服务' }
  }
  let result = null
  try {
    result = await Promise.race([
      account.getBalance({
        version:
          String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
        locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), ACCOUNT_FALLBACK_MS)),
    ])
  } catch (err) {
    return { ok: false, error: `账号余额接口失败：${shortError(err)}` }
  }
  if (!result) return { ok: false, error: '账号余额请求超时' }
  if (result.status !== 'ready') {
    return { ok: false, error: `账号余额未就绪（${String(result.status || 'unknown')}）` }
  }
  const wallets = [...(Array.isArray(result.value) ? result.value : []), ...(Array.isArray(result.bonusWallets) ? result.bonusWallets : [])]
    .filter((item) => item && Number.isFinite(Number(item.balance)))
  if (wallets.length === 0) return { ok: false, error: '账号没有可用余额钱包' }
  const cnyWallets = wallets.filter((item) => String(item.currency || 'CNY').toUpperCase() === 'CNY')
  const picked = cnyWallets.length ? cnyWallets : wallets
  const cny = picked.reduce((sum, item) => sum + Number(item.balance), 0)
  return {
    ok: true,
    cny: Number(cny.toFixed(6)),
    currency: String(picked[0]?.currency || 'CNY').toUpperCase(),
    source: 'account',
    at: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

function safeGet(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : null
  } catch {
    return null
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function shortError(error) {
  return String((error && error.message) || error || 'unknown').slice(0, 200)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
