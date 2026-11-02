window.__ModuleLoader__.load({
  id: 'dsh-chang-kaishen',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback, useMemo } = React
    const h = React.createElement

    try {
      window.__cksErrors = window.__cksErrors || []
      window.addEventListener('error', (event) => {
        try {
          window.__cksErrors.push(String((event.error && event.error.stack) || event.message || event))
        } catch {}
      })
      window.addEventListener('unhandledrejection', (event) => {
        try {
          window.__cksErrors.push('rejection: ' + String((event.reason && event.reason.stack) || event.reason))
        } catch {}
      })
    } catch {}

    const API = '/dsh-chang-kaishen'
    const RATE = 1e9 // 默认汇率：1 元 = 10 亿金元券（1949-05 上海收兑价折算）
    const SETTINGS_KEY = 'cks-settings-v1'
    const WIDGET_IMG = API + '/assets/qban-cutout.png'
    const TARGET_FACE_IMG = API + '/assets/target-meme.png'
    const TARGET_WEIGHTS_IMG = API + '/assets/target-meme-weights.png'
    const QR_IMG = API + '/assets/reward-qr.png'
    const GOLD_IMG = API + '/assets/gold-yuan-front.png'
    const H2C_URL = API + '/assets/html2canvas.min.js?v=1'

    // 用户指定台词（仅这 7 句 + 1 句原创微操梗）
    const LINES = [
      '优势在我！',
      '总座高见。',
      '我亲自部署、亲自指挥。',
      '微操一下，问题不大。',
      '运输大队长已就位。',
      '娘希匹！（已消音）',
      '鼠标左移5毫米。',
    ]

    const CYCLE_PRESETS = [3, 5, 10, 15, 20, 30]
    const MEDIUM_KINDS = ['run', 'block', 'balloon', 'gold', 'flood']

    const DEFAULT_SETTINGS = { cycleMinutes: 3, paused: false, x: null, y: null }

    function loadSettings() {
      try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
        return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function randomLine(except) {
      const pool = LINES.filter((line) => line !== except)
      return pool[Math.floor(Math.random() * pool.length)]
    }

    function rand(min, max) {
      return min + Math.random() * (max - min)
    }

    function formatGy(cny) {
      const gy = Math.max(0, Number(cny) || 0) * RATE
      if (!Number.isFinite(gy)) return '—'
      if (gy >= 1e12) return (gy / 1e12).toFixed(2) + ' 万亿'
      if (gy >= 1e8) return (gy / 1e8).toFixed(2) + ' 亿'
      if (gy >= 1e4) return (gy / 1e4).toFixed(2) + ' 万'
      return gy.toFixed(2)
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    // 用 html2canvas-pro 在页面内抓图：得到一张“干净”（可读像素）的画布，
    // 之后才能把屏幕像素重新排列成凯申头像。全程不出本机。
    let h2cPromise = null
    function loadHtml2Canvas() {
      if (window.html2canvas && typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas)
      if (!h2cPromise) {
        h2cPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = H2C_URL
          script.onload = () => resolve(window.html2canvas)
          script.onerror = () => reject(new Error('html2canvas load failed'))
          document.head.appendChild(script)
        })
      }
      return h2cPromise
    }

    function downscaleCanvas(canvas, maxSize) {
      if (canvas.width <= maxSize && canvas.height <= maxSize) return canvas
      const scale = Math.min(maxSize / canvas.width, maxSize / canvas.height)
      const out = document.createElement('canvas')
      out.width = Math.round(canvas.width * scale)
      out.height = Math.round(canvas.height * scale)
      const ctx = out.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, 0, 0, out.width, out.height)
      return out
    }

    // 源图：优先抓“当前屏幕”（DSH 窗口本身受系统内容保护，抓到的通常是桌面/壁纸），
    // 这样才有足够丰富的像素颜色可供重排；失败再退回页面内渲染。
    async function captureScreenCanvas() {
      try {
        const res = await fetch(API + '/screen.png?t=' + Date.now(), { cache: 'no-store' })
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          try {
            const image = await loadImage(url)
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            canvas.getContext('2d').drawImage(image, 0, 0)
            return downscaleCanvas(canvas, 1200)
          } finally {
            URL.revokeObjectURL(url)
          }
        }
      } catch {}
      const h2c = await loadHtml2Canvas()
      if (typeof h2c !== 'function') throw new Error('html2canvas unavailable')
      if (document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready
        } catch {}
      }
      const canvas = await h2c(document.documentElement, {
        backgroundColor: null,
        scale: 1,
        logging: false,
        useCORS: true,
      })
      return downscaleCanvas(canvas, 1200)
    }

    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('image load failed'))
        image.src = url
      })
    }

    // 把画布按网格取平均色
    function sampleCanvasGrid(canvas, cols, rows) {
      const w = canvas.width
      const h = canvas.height
      const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
      const out = new Uint8ClampedArray(cols * rows * 3)
      for (let gy = 0; gy < rows; gy++) {
        const y0 = Math.floor((gy * h) / rows)
        const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / rows))
        const sy = Math.max(1, Math.floor((y1 - y0) / 4))
        for (let gx = 0; gx < cols; gx++) {
          const x0 = Math.floor((gx * w) / cols)
          const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / cols))
          const sx = Math.max(1, Math.floor((x1 - x0) / 4))
          let r = 0
          let g = 0
          let b = 0
          let n = 0
          for (let y = y0; y < y1; y += sy) {
            for (let x = x0; x < x1; x += sx) {
              const i = (y * w + x) * 4
              r += data[i]
              g += data[i + 1]
              b += data[i + 2]
              n++
            }
          }
          const o = (gy * cols + gx) * 3
          out[o] = r / n
          out[o + 1] = g / n
          out[o + 2] = b / n
        }
      }
      return out
    }

    function sampleAlphaGrid(canvas, cols, rows) {
      const w = canvas.width
      const h = canvas.height
      const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
      const out = new Float32Array(cols * rows)
      for (let gy = 0; gy < rows; gy++) {
        const y0 = Math.floor((gy * h) / rows)
        const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / rows))
        for (let gx = 0; gx < cols; gx++) {
          const x0 = Math.floor((gx * w) / cols)
          const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / cols))
          let sum = 0
          let n = 0
          for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 3))) {
            for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 3))) {
              sum += data[(y * w + x) * 4 + 3]
              n++
            }
          }
          out[gy * cols + gx] = n ? sum / n : 0
        }
      }
      return out
    }

    // ============ 复刻《介石显示器》的像素重排显影 ============
    // 目标：屏幕上所有像素颜色保持原样，只重新排列位置，让排出来的图像看起来像凯申。
    // 算法与作者项目一致：16×16 匈牙利 → 32/64/128 逐层上采样 + 邻域随机交换；
    // 代价 = 颜色差² × 权重 + (位移² × 邻近重要度)²；权重：人物 255，背景 12。
    const DX_N = 128
    const DX_PROX = 13
    const DX_PROX_EXP = 2
    const DX_QUALITY = 32
    const DX_RAD0 = 8
    const DX_DECAY = 0.975
    const DX_LEVELS = [16, 32, 64, 128]

    function centerSquare(canvas) {
      const size = Math.min(canvas.width, canvas.height)
      const out = document.createElement('canvas')
      out.width = size
      out.height = size
      out.getContext('2d').drawImage(
        canvas,
        Math.floor((canvas.width - size) / 2),
        Math.floor((canvas.height - size) / 2),
        size,
        size,
        0,
        0,
        size,
        size,
      )
      return out
    }

    function resizePixelData(canvas, size) {
      const out = document.createElement('canvas')
      out.width = size
      out.height = size
      const ctx = out.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, 0, 0, size, size)
      return ctx.getImageData(0, 0, size, size).data
    }

    async function buildDisplayTarget(size) {
      // 目标图直接用《介石显示器》里的那张脸 + 它的权重蒙版，不再用 Q 版头像。
      const [image, weights] = await Promise.all([loadImage(TARGET_FACE_IMG), loadImage(TARGET_WEIGHTS_IMG)])
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, size, size)
      const weightCanvas = document.createElement('canvas')
      weightCanvas.width = size
      weightCanvas.height = size
      const wctx = weightCanvas.getContext('2d')
      wctx.imageSmoothingEnabled = true
      wctx.imageSmoothingQuality = 'high'
      wctx.drawImage(weights, 0, 0, size, size)
      return { canvas, weights: weightCanvas }
    }

    function dxCost(sPix, tPix, wts, s, ti, si, prox) {
      const t = ti * 4
      const sp = si * 4
      const dr = tPix[t] - sPix[sp]
      const dg = tPix[t + 1] - sPix[sp + 1]
      const db = tPix[t + 2] - sPix[sp + 2]
      const dc = dr * dr + dg * dg + db * db
      const dx = (ti % s) - (si % s)
      const dy = ((ti / s) | 0) - ((si / s) | 0)
      const q = (dx * dx + dy * dy) * prox
      return dc * wts[ti] + q * q
    }

    function dxHungarian(s, ld) {
      const n = s * s
      const INF = Infinity
      const u = new Float64Array(n + 1)
      const v = new Float64Array(n + 1)
      const p = new Int32Array(n + 1)
      const way = new Int32Array(n + 1)
      const minv = new Float64Array(n + 1)
      const used = new Uint8Array(n + 1)
      for (let i = 1; i <= n; i++) {
        p[0] = i
        let j0 = 0
        minv.fill(INF)
        used.fill(0)
        do {
          used[j0] = 1
          const i0 = p[j0]
          let delta = INF
          let j1 = 0
          for (let j = 1; j <= n; j++) {
            if (used[j]) continue
            const c = dxCost(ld.sPix, ld.tPix, ld.wts, s, i0 - 1, j - 1, ld.prox) - u[i0] - v[j]
            if (c < minv[j]) {
              minv[j] = c
              way[j] = j0
            }
            if (minv[j] < delta) {
              delta = minv[j]
              j1 = j
            }
          }
          for (let j = 0; j <= n; j++) {
            if (used[j]) {
              u[p[j]] += delta
              v[j] -= delta
            } else {
              minv[j] -= delta
            }
          }
          j0 = j1
        } while (p[j0] !== 0)
        do {
          const j1 = way[j0]
          p[j0] = p[j1]
          j0 = j1
        } while (j0)
      }
      const a = new Int32Array(n)
      for (let j = 1; j <= n; j++) a[p[j] - 1] = j - 1
      return a
    }

    function dxUpsample(prevPerm, sPrev, s, ld) {
      const f = s / sPrev
      const n = s * s
      const perm = new Int32Array(n).fill(-1)
      const taken = new Uint8Array(n)
      const conflicts = []
      for (let ty = 0; ty < s; ty++) {
        const pty = (ty / f) | 0
        const dy = ty - pty * f
        for (let tx = 0; tx < s; tx++) {
          const ptx = (tx / f) | 0
          const dx = tx - ptx * f
          const ps = prevPerm[pty * sPrev + ptx]
          const sx = (ps % sPrev) * f + dx
          const sy = ((ps / sPrev) | 0) * f + dy
          const si = sy * s + sx
          const ti = ty * s + tx
          if (!taken[si]) {
            taken[si] = 1
            perm[ti] = si
          } else {
            conflicts.push(ti)
          }
        }
      }
      const free = []
      for (let i = 0; i < n; i++) if (!taken[i]) free.push(i)
      for (let ci = 0; ci < conflicts.length; ci++) {
        const ti = conflicts[ci]
        let best = 0
        let bestC = Infinity
        const tries = Math.min(free.length, 48)
        for (let t = 0; t < tries; t++) {
          const k = (Math.random() * free.length) | 0
          const c = dxCost(ld.sPix, ld.tPix, ld.wts, s, ti, free[k], ld.prox)
          if (c < bestC) {
            bestC = c
            best = k
          }
        }
        const si = free[best]
        free[best] = free[free.length - 1]
        free.pop()
        perm[ti] = si
      }
      return perm
    }

    async function dxRefine(s, perm, ld, generations) {
      const n = s * s
      const cur = new Float64Array(n)
      const pos = new Int32Array(n)
      for (let ti = 0; ti < n; ti++) {
        const si = perm[ti]
        pos[si] = ti
        cur[ti] = dxCost(ld.sPix, ld.tPix, ld.wts, s, ti, si, ld.prox)
      }
      let radius = DX_RAD0
      for (let gen = 0; gen < generations; gen++) {
        const rad = Math.max(1, Math.round(radius))
        const attempts = DX_QUALITY * n
        const span = 2 * rad + 1
        for (let it = 0; it < attempts; it++) {
          const a = (Math.random() * n) | 0
          const ax = a % s
          const ay = (a / s) | 0
          let bx = ax + ((Math.random() * span) | 0) - rad
          bx = bx < 0 ? 0 : bx >= s ? s - 1 : bx
          let by = ay + ((Math.random() * span) | 0) - rad
          by = by < 0 ? 0 : by >= s ? s - 1 : by
          const b = by * s + bx
          if (a === b) continue
          const sa = perm[a]
          const sb = perm[b]
          const c1 = dxCost(ld.sPix, ld.tPix, ld.wts, s, b, sa, ld.prox)
          const c2 = dxCost(ld.sPix, ld.tPix, ld.wts, s, a, sb, ld.prox)
          const nw = c1 + c2
          const old = cur[a] + cur[b]
          if (nw < old) {
            perm[a] = sb
            perm[b] = sa
            pos[sa] = b
            pos[sb] = a
            cur[a] = c2
            cur[b] = c1
          }
        }
        radius = Math.max(1.35, radius * DX_DECAY)
        if (gen % 2 === 1) await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return perm
    }

    async function solveDisplayEffect(sourceCanvas) {
      const square = centerSquare(sourceCanvas)
      const target = await buildDisplayTarget(square.width)
      const cache = new Map()
      const getLevel = (s) => {
        if (cache.has(s)) return cache.get(s)
        const src = resizePixelData(square, s)
        const tgt = resizePixelData(target.canvas, s)
        const weightPix = resizePixelData(target.weights, s)
        const wts = new Int32Array(s * s)
        for (let i = 0; i < s * s; i++) wts[i] = weightPix[i * 4]
        const prox = DX_PROX * Math.pow(DX_N / s, DX_PROX_EXP)
        const ld = { sPix: src, tPix: tgt, wts, prox }
        cache.set(s, ld)
        return ld
      }
      let prevS = DX_LEVELS[0]
      let perm = dxHungarian(prevS, getLevel(prevS))
      for (let li = 1; li < DX_LEVELS.length; li++) {
        const s = DX_LEVELS[li]
        const ld = getLevel(s)
        perm = dxUpsample(perm, prevS, s, ld)
        const gens = s === DX_N ? 10 : 8
        perm = await dxRefine(s, perm, ld, gens)
        prevS = s
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return { level: DX_N, perm, sPix: getLevel(DX_N).sPix }
    }

    // 终极大乱：原屏幕像素按置换飞向新位置，最后“显影”成凯申
    function PixelMorphCanvas({ sourceCanvas, onReady }) {
      const canvasRef = useRef(null)
      const onReadyRef = useRef(onReady)
      onReadyRef.current = onReady
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        if (!sourceCanvas) {
          setFailed(true)
          return
        }
        const canvas = canvasRef.current
        if (!canvas) return
        const { w, h } = viewport()
        canvas.width = w
        canvas.height = h
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        let cancelled = false
        let raf = 0
        ;(async () => {
          try {
            ctx.drawImage(sourceCanvas, 0, 0, w, h)
          } catch {
            setFailed(true)
            return
          }
          let plan = null
          try {
            plan = await solveDisplayEffect(sourceCanvas)
          } catch {
            setFailed(true)
            return
          }
          if (cancelled || !plan) return
          const { level, perm, sPix } = plan
          const size = Math.max(w, h)
          const cell = size / level
          const ox = (w - size) / 2
          const oy = (h - size) / 2
          const n = level * level
          const startX = new Float32Array(n)
          const startY = new Float32Array(n)
          const endX = new Float32Array(n)
          const endY = new Float32Array(n)
          for (let ti = 0; ti < n; ti++) {
            const si = perm[ti]
            const sx = si % level
            const sy = (si / level) | 0
            const tx = ti % level
            const ty = (ti / level) | 0
            startX[ti] = ox + (sx + 0.5) * cell
            startY[ti] = oy + (sy + 0.5) * cell
            endX[ti] = ox + (tx + 0.5) * cell
            endY[ti] = oy + (ty + 0.5) * cell
          }
          const draw = (progress) => {
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
            ctx.fillStyle = '#05080c'
            ctx.fillRect(0, 0, w, h)
            for (let ti = 0; ti < n; ti++) {
              const si = perm[ti]
              const si4 = si * 4
              const cr = sPix[si4]
              const cg = sPix[si4 + 1]
              const cb = sPix[si4 + 2]
              const x = startX[ti] + (endX[ti] - startX[ti]) * ease
              const y = startY[ti] + (endY[ti] - startY[ti]) * ease
              ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')'
              ctx.fillRect(x - cell / 2 - 0.5, y - cell / 2 - 0.5, cell + 1, cell + 1)
            }
            ctx.fillStyle = 'rgba(0,0,0,0.05)'
            for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
          }
          const start = performance.now()
          const duration = 5200
          let lastDraw = 0
          let notified = false
          const frame = (now) => {
            if (cancelled) return
            if (now - lastDraw >= 30) {
              lastDraw = now
              draw(Math.min(1, (now - start) / duration))
            }
            if (!notified && now - start >= duration) {
              notified = true
              try { if (onReadyRef.current) onReadyRef.current() } catch {}
            }
            if (now - start < duration) raf = requestAnimationFrame(frame)
          }
          raf = requestAnimationFrame(frame)
        })()
        return () => {
          cancelled = true
          cancelAnimationFrame(raf)
        }
      }, [sourceCanvas])

      if (failed) return h(ScrambleCanvas, { sourceCanvas: null })
      return h('div', { className: 'cks-morph-wrap' }, h('canvas', { ref: canvasRef, className: 'cks-morph-canvas' }))
    }

    function viewport() {
      return { w: window.innerWidth || 1280, h: window.innerHeight || 800 }
    }

    // ------------------------------------------------------------------
    // 终极大乱的“像素打乱”画布
    // ------------------------------------------------------------------
    function ScrambleCanvas({ sourceCanvas }) {
      const canvasRef = useRef(null)

      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const { w, h } = viewport()
        canvas.width = w
        canvas.height = h
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const off = document.createElement('canvas')
        off.width = w
        off.height = h
        const offCtx = off.getContext('2d')
        if (!offCtx) return

        const paintSynthetic = () => {
          const grad = offCtx.createLinearGradient(0, 0, w, h)
          grad.addColorStop(0, '#070b11')
          grad.addColorStop(0.5, '#121a24')
          grad.addColorStop(1, '#070b11')
          offCtx.fillStyle = grad
          offCtx.fillRect(0, 0, w, h)
          const palette = ['#0b1220', '#16202e', '#0f1a17', '#1b232e', '#101720']
          for (let i = 0; i < 90; i++) {
            offCtx.fillStyle = palette[i % palette.length]
            offCtx.globalAlpha = 0.6
            offCtx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 160 + 20, Math.random() * 60 + 8)
          }
          offCtx.globalAlpha = 1
        }

        if (sourceCanvas && sourceCanvas.width > 0) {
          try {
            offCtx.drawImage(sourceCanvas, 0, 0, w, h)
          } catch {
            paintSynthetic()
          }
        } else {
          paintSynthetic()
        }

        const tile = Math.max(22, Math.round(Math.min(w, h) / 16))
        const start = performance.now()
        let raf = 0
        const frame = (now) => {
          const progress = Math.min(1, (now - start) / 2000)
          ctx.fillStyle = '#05080c'
          ctx.fillRect(0, 0, w, h)
          const cols = Math.ceil(w / tile)
          const rows = Math.ceil(h / tile)
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const jitter = progress * 12
              const sx = clamp(x * tile + rand(-1, 1) * jitter, 0, Math.max(0, w - tile))
              const sy = clamp(y * tile + rand(-1, 1) * jitter, 0, Math.max(0, h - tile))
              try {
                ctx.drawImage(off, sx, sy, tile, tile, x * tile, y * tile, tile, tile)
              } catch {}
            }
          }
          if (progress < 1) {
            ctx.fillStyle = 'rgba(125, 255, 176, 0.06)'
            ctx.fillRect(0, (progress * h) % h, w, 2)
          }
          if (now - start < 2000) raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf)
      }, [sourceCanvas])

      return h('canvas', { ref: canvasRef, className: 'cks-scramble' })
    }


    class ChangKaiShenWidgetErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        try {
          window.__cksErrors = window.__cksErrors || []
          window.__cksErrors.push(String(error && (error.stack || error.message || error)))
        } catch {}
      }
      render() {
        if (this.state.error) {
          return h(
            'div',
            {
              style: {
                position: 'fixed',
                left: 16,
                top: 16,
                zIndex: 2147483647,
                maxWidth: 620,
                background: '#3a0f12',
                color: '#ffd9d9',
                border: '1px solid #ff6b6b',
                borderRadius: 10,
                padding: '10px 14px',
                font: '12px/1.6 ui-monospace, monospace',
                whiteSpace: 'pre-wrap',
                pointerEvents: 'auto',
              },
            },
            '常凯申挂件渲染失败：' + String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error)),
          )
        }
        return this.props.children
      }
    }

    // 用 error boundary 包住，任何渲染异常都会显示出来而不是静默消失
    function ChangKaiShenWidgetGuarded() {
      return h(ChangKaiShenWidgetErrorBoundary, null, h(ChangKaiShenWidget))
    }

    // ------------------------------------------------------------------
    // 挂件本体
    // ------------------------------------------------------------------
    function ChangKaiShenWidget() {
      const initialSettings = useRef(null)
      if (!initialSettings.current) initialSettings.current = loadSettings()

      const settingsRef = useRef(initialSettings.current)
      const [settings, setSettings] = useState(initialSettings.current)
      const [pos, setPos] = useState(() =>
        initialSettings.current.x != null && initialSettings.current.y != null
          ? { x: initialSettings.current.x, y: initialSettings.current.y }
          : null,
      )
      const [cycleStart, setCycleStart] = useState(() => Date.now())
      const [now, setNow] = useState(Date.now())
      const [balance, setBalance] = useState({ status: 'loading' })
      const [bubble, setBubble] = useState(null)
      const [event, setEvent] = useState(null)
      const [motion, setMotion] = useState(null)
      const [finale, setFinale] = useState(null)
      const [finaleReady, setFinaleReady] = useState(false)
      const [menuOpen, setMenuOpen] = useState(false)
      const [menuBelow, setMenuBelow] = useState(false)
      const [modal, setModal] = useState(null)
      const [dragging, setDragging] = useState(false)

      const widgetRef = useRef(null)
      const dragRef = useRef(null)
      const longPressRef = useRef(null)
      const timersRef = useRef(new Set())
      const eventRef = useRef(null)
      const nextEventAtRef = useRef(0)
      const lastKindRef = useRef(null)
      const finaleRef = useRef(null)
      const balanceTimerRef = useRef(null)
      const menuRef = useRef(null)
      const timeoutsRef = useRef(new Set())

      const cycleSeconds = Math.max(10, Number(settings.cycleMinutes || 3) * 60)
      const phase = now - cycleStart < (cycleSeconds * 1000) / 3 ? 'idle' : now - cycleStart < cycleSeconds * 1000 ? 'medium' : 'finale'

      const updateSettings = useCallback((patch) => {
        setSettings((prev) => {
          const next = { ...prev, ...patch }
          settingsRef.current = next
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
          } catch {}
          return next
        })
      }, [])

      const safeTimeout = useCallback((fn, ms) => {
        const id = setTimeout(() => {
          timeoutsRef.current.delete(id)
          fn()
        }, ms)
        timeoutsRef.current.add(id)
        return id
      }, [])

      useEffect(() => {
        settingsRef.current = settings
      }, [settings])

      // 只统计“可见”的时间：窗口隐藏时把累计起点向后顺延
      useEffect(() => {
        let hiddenAt = 0
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') hiddenAt = Date.now()
          else if (hiddenAt) {
            const delta = Date.now() - hiddenAt
            hiddenAt = 0
            setCycleStart((value) => value + delta)
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
      }, [])

      // 余额
      const refreshBalance = useCallback(async (force) => {
        try {
          const res = await fetch(API + '/balance.json' + (force ? '?refresh=1' : ''), { cache: 'no-store' })
          const data = await res.json()
          if (data && data.ok) {
            setBalance({ status: 'ok', cny: data.cny, source: data.source, stale: !!data.stale, at: data.at })
          } else {
            setBalance({ status: 'error', error: (data && data.error) || '读取失败' })
          }
        } catch (err) {
          setBalance({ status: 'error', error: String((err && err.message) || err) })
        }
      }, [])

      useEffect(() => {
        refreshBalance(false)
        const id = setInterval(() => refreshBalance(false), 60_000)
        return () => clearInterval(id)
      }, [refreshBalance])

      const showBubble = useCallback((mode, text) => {
        setBubble({ mode, text: text || null, key: Date.now() })
      }, [])
      const showBalance = useCallback(() => showBubble('balance'), [showBubble])
      const showQuote = useCallback((text) => showBubble('quote', text || randomLine(null)), [showBubble])
      const advanceBubble = useCallback(() => {
        setBubble((current) => {
          if (!current) return { mode: 'balance', key: Date.now() }
          if (current.mode === 'balance') return { mode: 'quote', text: randomLine(current.text || null), key: Date.now() }
          return null
        })
      }, [])

      const clearEvent = useCallback((nextNow) => {
        eventRef.current = null
        setEvent(null)
        setMotion(null)
        if (nextNow) {
          const cycleSec = Math.max(10, Number(settingsRef.current.cycleMinutes || 3) * 60)
          const intervalMs = Math.max(3500, ((cycleSec * 2) / 3 / 8) * 1000)
          nextEventAtRef.current = nextNow + rand(intervalMs * 0.6, intervalMs * 1.25)
        }
      }, [])

      // 终极大乱
      const defeatFinale = useCallback((auto) => {
        if (!finaleRef.current) return
        const state = { ...finaleRef.current, stage: 'defeat' }
        finaleRef.current = state
        setFinale(state)
        safeTimeout(() => {
          finaleRef.current = null
          setFinale(null)
          setFinaleReady(false)
          eventRef.current = null
          setEvent(null)
          setMotion(null)
          nextEventAtRef.current = 0
          const nextStart = Date.now()
          setCycleStart(nextStart)
          if (!auto) showQuote()
        }, 950)
      }, [safeTimeout, showQuote])

      const startFinale = useCallback(() => {
        if (finaleRef.current) return
        clearEvent()
        setBubble(null)
        setFinaleReady(false)
        finaleRef.current = { stage: 'capturing' }
        ;(async () => {
          let sourceCanvas = null
          try {
            sourceCanvas = await captureScreenCanvas()
          } catch {}
          const morph = { stage: 'morph', sourceCanvas, startedAt: Date.now() }
          finaleRef.current = morph
          setFinale(morph)
          // 安全兜底：如果用户一直不点，60 秒后自己撤退
          safeTimeout(() => {
            if (finaleRef.current) defeatFinale(true)
          }, 60000)
        })()
      }, [clearEvent, defeatFinale, safeTimeout])

      // 中等事件
      const triggerEvent = useCallback((cycle) => {
        if (finaleRef.current || eventRef.current) return
        let kind = MEDIUM_KINDS[Math.floor(Math.random() * MEDIUM_KINDS.length)]
        if (kind === lastKindRef.current) {
          kind = MEDIUM_KINDS[(MEDIUM_KINDS.indexOf(kind) + 1 + Math.floor(Math.random() * 4)) % MEDIUM_KINDS.length]
        }
        lastKindRef.current = kind
        const baseDurations = { run: 8000, block: 9000, balloon: 9000, gold: 8000, flood: 9000 }
        const scaled = Math.min(baseDurations[kind], Math.max(2800, Math.round((cycle * 1000) / 10)))
        const item = { kind, until: Date.now() + scaled, startedAt: Date.now(), key: Date.now() }
        eventRef.current = item
        setEvent(item)
        nextEventAtRef.current = 0
      }, [])

      // 主计时器
      useEffect(() => {
        const id = setInterval(() => {
          if (settingsRef.current.paused) return
          if (document.visibilityState === 'hidden') return
          const t = Date.now()
          setNow(t)
          const total = Math.max(10, Number(settingsRef.current.cycleMinutes || 3) * 60) * 1000
          const elapsed = t - cycleStart
          if (elapsed >= total) {
            if (!finaleRef.current) startFinale()
            return
          }
          if (elapsed >= total / 3) {
            const current = eventRef.current
            if (current) {
              if (t >= current.until) clearEvent(t)
            } else {
              if (!nextEventAtRef.current) {
                const mediumMs = (total * 2) / 3
                const intervalMs = Math.max(3500, mediumMs / 8)
                nextEventAtRef.current = t + rand(intervalMs * 0.25, intervalMs * 0.9)
              }
              if (t >= nextEventAtRef.current) triggerEvent(total / 1000)
            }
          }
        }, 500)
        return () => clearInterval(id)
      }, [cycleStart, settings.cycleMinutes, settings.paused, startFinale, clearEvent, triggerEvent])

      // 事件动画：乱跑 / 挡屏 / 气球
      useEffect(() => {
        if (!event) {
          setMotion(null)
          return
        }
        const { w, h } = viewport()
        const widget = widgetRef.current
        const width = widget ? widget.offsetWidth || 150 : 150
        const height = widget ? widget.offsetHeight || 190 : 190
        const randomPoint = (margin = 30) => ({
          x: rand(margin, Math.max(margin, w - width - margin)),
          y: rand(margin, Math.max(margin, h - height - margin)),
        })
        if (event.kind === 'run') {
          const move = () => setMotion({ ...randomPoint(20), scale: 1 })
          move()
          const id = setInterval(move, 1050)
          return () => clearInterval(id)
        }
        if (event.kind === 'block') {
          setMotion({
            x: rand(w * 0.18, Math.max(w * 0.18, w - width * 2.2 - 40)),
            y: rand(h * 0.22, Math.max(h * 0.22, h - height * 2.2 - 40)),
            scale: 2.2,
          })
          return
        }
        if (event.kind === 'balloon') {
          setMotion({ x: rand(40, Math.max(40, w - width * 2 - 40)), y: rand(h * 0.45, Math.max(h * 0.45, h - height - 60)), scale: 1.35 })
          const id = setTimeout(() => {
            setMotion({ x: rand(40, Math.max(40, w - width * 2.1 - 40)), y: 30, scale: 2.1 })
          }, 500)
          return () => clearTimeout(id)
        }
        return
      }, [event])

      // 菜单外点关闭
      useEffect(() => {
        if (!menuOpen) return
        const onDown = (e) => {
          if (menuRef.current && menuRef.current.contains(e.target)) return
          setMenuOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [menuOpen])

      // 初始位置测量 + 窗口缩放夹取
      useEffect(() => {
        const measure = () => {
          const widget = widgetRef.current
          if (!widget) return
          const { w, h } = viewport()
          const rect = widget.getBoundingClientRect()
          const width = rect.width || 150
          const height = rect.height || 190
          setPos((current) => {
            const base = current || { x: rect.left, y: rect.top }
            const next = {
              x: clamp(base.x, 8, Math.max(8, w - width - 8)),
              y: clamp(base.y, 8, Math.max(8, h - height - 8)),
            }
            if (current && next.x === current.x && next.y === current.y) return current
            if (!current) return next
            settingsRef.current = { ...settingsRef.current, x: next.x, y: next.y }
            try {
              localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsRef.current))
            } catch {}
            return next
          })
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      // 待机时它也会主动弹一次余额气泡（不挡操作，点气泡可继续/关闭）
      useEffect(() => {
        if (settings.paused || finale || event || modal) return
        if (phase !== 'idle') return
        const id = setInterval(() => {
          if (document.visibilityState === 'hidden') return
          setBubble((current) => current || { mode: 'balance', key: Date.now() })
        }, 45_000)
        return () => clearInterval(id)
      }, [settings.paused, finale, event, modal, phase])

      // 清理
      useEffect(() => {
        return () => {
          if (longPressRef.current) clearTimeout(longPressRef.current)
          for (const id of Array.from(timeoutsRef.current)) clearTimeout(id)
          timeoutsRef.current.clear()
        }
      }, [])

      const isFinale = Boolean(finale)
      const displayPos = motion
        ? { x: motion.x, y: motion.y }
        : pos || (typeof window !== 'undefined'
            ? { x: 20, y: Math.max(20, (window.innerHeight || 800) - 280) }
            : { x: 40, y: 40 })
      const widgetScale = motion ? motion.scale || 1 : 1
      const amountText = balance.status === 'ok' ? formatGy(balance.cny) : balance.status === 'loading' ? '读取中' : '—'

      // 点击/拖拽
      const clearLongPress = () => {
        if (longPressRef.current) {
          clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }

      const handleClick = () => {
        if (finale) {
          if (finale.stage === 'morph' && finaleReady) defeatFinale(false)
          return
        }
        if (eventRef.current) {
          clearEvent(Date.now())
          showQuote()
          return
        }
        advanceBubble()
      }

      const onWidgetClick = (e) => {
        if (finale && finale.stage === 'morph' && finaleReady) {
          e.stopPropagation()
          defeatFinale(false)
        }
      }

      const onPointerDown = (e) => {
        if (e.button !== 0) return
        if (finale) return
        if (e.target && e.target.closest && e.target.closest('.cks-menu, .cks-bubble, .cks-modal, .cks-modal-mask')) return
        const el = widgetRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
          moved: false,
          rect,
        }
        try {
          el.setPointerCapture(e.pointerId)
        } catch {}
        setDragging(true)
        clearLongPress()
        longPressRef.current = setTimeout(() => {
          const widget = widgetRef.current
          if (!widget) return
          const r = widget.getBoundingClientRect()
          setMenuBelow(r.top < 280)
          setMenuOpen(true)
          setDragging(false)
          if (dragRef.current) dragRef.current.moved = true
          dragRef.current = null
        }, 650)
      }

      const onPointerMove = (e) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) > 6) {
          drag.moved = true
          clearLongPress()
        }
        if (!drag.moved) return
        const rect = drag.rect
        const { w, h } = viewport()
        setPos({
          x: clamp(e.clientX - drag.offsetX, 8, Math.max(8, w - rect.width - 8)),
          y: clamp(e.clientY - drag.offsetY, 8, Math.max(8, h - rect.height - 8)),
        })
      }

      const finishDrag = (e) => {
        clearLongPress()
        const drag = dragRef.current
        dragRef.current = null
        setDragging(false)
        if (!drag) return
        try {
          widgetRef.current && widgetRef.current.releasePointerCapture(e.pointerId)
        } catch {}
        if (!drag.moved) {
          handleClick()
          return
        }
        // 吸附到最近的左右边缘
        const rect = widgetRef.current ? widgetRef.current.getBoundingClientRect() : drag.rect
        const { w } = viewport()
        const snappedX = rect.left + rect.width / 2 < w / 2 ? 16 : Math.max(16, w - rect.width - 16)
        const next = { x: snappedX, y: clamp(rect.top, 8, Math.max(8, (window.innerHeight || 800) - rect.height - 8)) }
        setPos(next)
        updateSettings({ x: next.x, y: next.y })
      }

      const openMenu = (e) => {
        if (finale) return
        if (e) e.preventDefault()
        const widget = widgetRef.current
        if (!widget) return
        const rect = widget.getBoundingClientRect()
        setMenuBelow(rect.top < 280)
        setMenuOpen(true)
      }

      const onContextMenu = (e) => {
        e.preventDefault()
        openMenu()
      }

      // ------------------------------------------------------------------
      // 渲染
      // ------------------------------------------------------------------
      const style = {
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483000,
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ui-monospace, monospace',
      }

      const vp = viewport()
      const finalDisplayPos = isFinale
        ? { x: Math.max(8, vp.w / 2 - 98), y: Math.max(8, vp.h - 310) }
        : displayPos
      const widgetStyle = {
        position: 'fixed',
        left: finalDisplayPos.x + 'px',
        top: finalDisplayPos.y + 'px',
        width: '196px',
        pointerEvents: 'auto',
        zIndex: isFinale ? 2147483200 : 2147483010,
        touchAction: 'none',
        userSelect: 'none',
        transform: 'scale(' + widgetScale + ')',
        transformOrigin: 'bottom center',
        transition: dragging ? 'none' : 'left 0.95s cubic-bezier(.2,.8,.2,1), top 0.95s cubic-bezier(.2,.8,.2,1), transform 1.6s ease-in-out',
        cursor: dragging ? 'grabbing' : 'grab',
      }

      const bubbleBelow = (isFinale ? finalDisplayPos : displayPos).y < 240
      const alignLeft = (isFinale ? finalDisplayPos : displayPos).x < 300
      const menuSide = menuBelow ? 'below' : 'above'

      const bills = useMemo(() => {
        if (!event || event.kind !== 'gold') return []
        return Array.from({ length: 18 }).map((_, index) => ({
          id: index,
          left: rand(2, 88),
          delay: rand(0, 1.6),
          duration: rand(5, 8.5),
          rotate: rand(-20, 20),
          scale: rand(0.7, 1.25),
        }))
      }, [event && event.key])


      const widget = h(
        'div',
        {
          ref: widgetRef,
          className:
            'cks-widget' +
            (dragging ? ' cks-dragging' : '') +
            (event ? ' cks-event-' + event.kind : '') +
            (isFinale ? ' cks-finale-widget' : ''),
          style: widgetStyle,
          onPointerDown,
          onPointerMove,
          onPointerUp: finishDrag,
          onPointerCancel: finishDrag,
          onClick: onWidgetClick,
          onContextMenu,
          role: 'button',
          tabIndex: 0,
          'aria-label': '常凯申挂件，点击查看台词',
        },
        h(
          'div',
          { className: 'cks-figure' },
          h('img', { src: WIDGET_IMG, alt: '常凯申 Q 版形象', draggable: false }),
        ),
        isFinale && finale && finale.stage === 'morph'
          ? h('div', { className: 'cks-defeat-hint' }, finaleReady ? '点击凯申，打败他！' : '显影中…')
          : null,
        bubble
          ? h(
              'div',
              {
                className: 'cks-bubble ' + (bubbleBelow ? 'cks-below' : '') + (alignLeft ? ' cks-align-left' : ''),
                onClick: (e) => {
                  e.stopPropagation()
                  advanceBubble()
                },
                onPointerDown: (e) => e.stopPropagation(),
              },
              bubble.mode === 'balance'
                ? '金元券余额\n' + amountText
                : bubble.text,
            )
          : null,
        menuOpen
          ? h(
              'div',
              {
                className: 'cks-menu ' + (menuSide === 'below' ? 'cks-below' : '') + (alignLeft ? ' cks-align-left' : ''),
                ref: menuRef,
                onPointerDown: (e) => e.stopPropagation(),
              },
              h('div', { className: 'cks-menu-title' }, '凯申显示器 OSD'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cks-menu-item cks-switch-row',
                  onClick: () => {
                    const nextPaused = !settings.paused
                    updateSettings({ paused: nextPaused })
                    eventRef.current = null
                    setEvent(null)
                    setMotion(null)
                    nextEventAtRef.current = 0
                    if (!nextPaused) setCycleStart(Date.now())
                  },
                },
                h('span', null, '捣乱开关'),
                h('span', { className: 'cks-switch' + (settings.paused ? '' : ' is-on') }, settings.paused ? '关' : '开'),
              ),
              h('div', { className: 'cks-menu-sep' }),
              h('div', { className: 'cks-menu-label' }, '循环时长'),
              h(
                'div',
                { className: 'cks-presets' },
                CYCLE_PRESETS.map((minutes) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      key: minutes,
                      className: 'cks-preset' + (Number(settings.cycleMinutes) === minutes ? ' is-active' : ''),
                      onClick: () => {
                        updateSettings({ cycleMinutes: minutes })
                        eventRef.current = null
                        setEvent(null)
                        setMotion(null)
                        nextEventAtRef.current = 0
                        setCycleStart(Date.now())
                      },
                    },
                    minutes + ' 分',
                  ),
                ),
              ),
              h('div', { className: 'cks-menu-sep' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cks-menu-item',
                  onClick: () => {
                    refreshBalance(true)
                  },
                },
                '刷新金元券余额',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cks-menu-item',
                  onClick: () => {
                    setModal('reward')
                  },
                },
                '支持作者',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cks-menu-item',
                  onClick: () => {
                    setModal('about')
                  },
                },
                '汇率与说明',
              ),
              h('div', { className: 'cks-menu-sep' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'cks-menu-item',
                  onClick: () => setMenuOpen(false),
                },
                '关闭菜单',
              ),
              balance.status === 'ok'
                ? h(
                    'div',
                    { className: 'cks-menu-foot' },
                    '余额来源：' +
                      (balance.source === 'account' ? 'DSH 账号' : 'DeepSeek API Key') +
                      (balance.stale ? '（缓存）' : '') +
                      ' · 1 元 = 10 亿金元券',
                  )
                : h('div', { className: 'cks-menu-foot' }, '余额：' + (balance.error || '未读取到')),
            )
          : null,
      )

      const finaleView = finale && (finale.stage === 'morph' || finale.stage === 'defeat')
        ? h(
            'div',
            { className: 'cks-finale-stage ' + (finale.stage === 'defeat' ? 'cks-defeating' : '') },
            finale.sourceCanvas
              ? h(PixelMorphCanvas, { sourceCanvas: finale.sourceCanvas, onReady: () => setFinaleReady(true) })
              : h(ScrambleCanvas, { sourceCanvas: null }),
            h('div', { className: 'cks-finale-osd' }, finale.stage === 'defeat' ? '信号中断' : '凯申显示器 · 信号源：你的屏幕'),
          )
        : null

      const modalView = modal
        ? h(
            'div',
            {
              className: 'cks-modal-mask',
              onPointerDown: (e) => {
                if (e.target === e.currentTarget) setModal(null)
              },
            },
            h(
              'div',
              { className: 'cks-modal' },
              modal === 'reward'
                ? [
                    h('div', { className: 'cks-modal-title', key: 't' }, '支持作者'),
                    h('img', { key: 'q', className: 'cks-qr', src: QR_IMG, alt: '微信赞赏码' }),
                    h('div', { className: 'cks-modal-text', key: 'x' }, '给作者的大肥鱼喂一点白饭吧，顺便给作者也买杯奶茶。'),
                    h('div', { className: 'cks-modal-small', key: 's' }, '微信扫码赞赏 · 感谢你让凯申继续上岗'),
                    h('button', { key: 'b', type: 'button', className: 'cks-modal-close', onClick: () => setModal(null) }, '关闭'),
                  ]
                : [
                    h('div', { className: 'cks-modal-title', key: 't' }, '汇率与说明'),
                    h(
                      'div',
                      { className: 'cks-modal-text', key: 'x' },
                      '余额按 1949 年 5 月上海解放时的收兑价折算：10 万金圆券 = 1 元旧人民币；1955 年发行新人民币，1 元新币 = 旧币 1 万元。因此这里按 1 元 = 10 亿金元券 显示。',
                    ),
                    h(
                      'div',
                      { className: 'cks-modal-small', key: 'y' },
                      '余额读取自本机 DSH 的 DeepSeek 凭据或账号，只在本机使用，不上传；金元券只是历史梗，不是真实金融换算。',
                    ),
                    h('button', { key: 'b', type: 'button', className: 'cks-modal-close', onClick: () => setModal(null) }, '关闭'),
                  ],
            ),
          )
        : null

      const fx =
        event && event.kind === 'gold'
          ? h(
              'div',
              { className: 'cks-fx' },
              h('div', { className: 'cks-event-text is-gold' }, '工作的太辛苦了，奖励你金元券'),
              bills.map((bill) =>
                h(
                  'div',
                  {
                    key: bill.id,
                    className: 'cks-bill',
                    style: {
                      left: bill.left + 'vw',
                      width: Math.round(148 * bill.scale) + 'px',
                      animationDelay: bill.delay + 's',
                      animationDuration: bill.duration + 's',
                      '--rot': bill.rotate + 'deg',
                    },
                  },
                  h('img', { src: GOLD_IMG, alt: '金圆券', draggable: false }),
                ),
              ),
            )
          : event && event.kind === 'flood'
            ? h(
                'div',
                { className: 'cks-fx cks-flood-fx' },
                h('div', { className: 'cks-event-text is-flood' }, '花园口决堤，黄河水要来喽！'),
                h(
                  'div',
                  { className: 'cks-flood', 'aria-hidden': true },
                  [0, 1, 2, 3, 4, 5].map((wave) =>
                    h('div', {
                      key: wave,
                      className: 'cks-flood-wave',
                      style: {
                        bottom: wave * 3 + '%',
                        animationDelay: -wave * 0.65 + 's',
                        opacity: 0.55 + wave * 0.07,
                      },
                    }),
                  ),
                ),
              )
            : null

      return h(
        'div',
        { className: 'cks-root', style },
        h('style', null, CSS),
        finaleView,
        fx,
        finale && finale.stage === 'scramble' ? null : widget,
        modalView,
      )
    }

    // ------------------------------------------------------------------
    // 样式
    // ------------------------------------------------------------------
    const CSS = `
.cks-widget{width:168px;display:flex;flex-direction:column;align-items:stretch;gap:0;filter:drop-shadow(0 14px 24px rgba(0,0,0,.55));}
.cks-device{position:relative;background:linear-gradient(180deg,#141b25,#0a0f16);border:2px solid #2b3643;border-radius:20px;padding:8px 8px 6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),0 0 0 1px #05080c,0 10px 28px rgba(0,0,0,.5);}
.cks-antenna{position:absolute;top:-24px;right:18px;width:2px;height:26px;background:linear-gradient(#4a5868,#212a35);transform:rotate(18deg);border-radius:2px;}
.cks-antenna::before{content:"";position:absolute;top:-5px;left:-3px;width:8px;height:8px;border-radius:50%;background:#7dffb0;box-shadow:0 0 10px rgba(125,255,176,.7);}
.cks-screen{position:relative;border-radius:14px;overflow:hidden;background:#c9c9c9;border:1px solid #33404e;}
.cks-screen img{display:block;width:100%;height:auto;pointer-events:none;}
.cks-screen-glow{position:absolute;inset:0;border-radius:14px;pointer-events:none;background:linear-gradient(180deg,rgba(125,255,176,.05),transparent 28%,transparent 74%,rgba(0,0,0,.24));mix-blend-mode:screen;}
.cks-lcd{margin-top:6px;background:#04140c;border:1px solid #173324;border-radius:8px;padding:4px 8px;display:flex;align-items:baseline;gap:6px;color:#7dffb0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.04em;overflow:hidden;}
.cks-lcd-label{opacity:.7;font-size:10px;white-space:nowrap;}
.cks-lcd-amount{font-size:13px;font-weight:700;text-shadow:0 0 8px rgba(125,255,176,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cks-lcd-dot{width:6px;height:6px;border-radius:50%;margin-left:auto;background:#4f6b5b;flex:0 0 auto;}
.cks-lcd-dot[data-state="ok"]{background:#7dffb0;box-shadow:0 0 8px rgba(125,255,176,.8);}
.cks-lcd-dot[data-state="error"]{background:#ff7777;box-shadow:0 0 8px rgba(255,119,119,.6);}
.cks-hint{margin-top:5px;color:#8da0b4;font-size:9.5px;text-align:center;letter-spacing:.02em;white-space:nowrap;opacity:.85;transition:opacity .2s;}
.cks-hint-defeat{color:#ffd479;font-size:11px;opacity:1;animation:cks-pulse 1s infinite;}
.cks-bubble{position:absolute;right:0;bottom:calc(100% + 16px);width:244px;min-height:104px;display:flex;align-items:center;justify-content:center;text-align:center;padding:22px 30px;background:#fffdf6;border:2.5px solid #101418;border-radius:50%;color:#14181c;font-size:14px;line-height:1.5;font-weight:600;letter-spacing:.02em;box-shadow:5px 6px 0 rgba(0,0,0,.22),0 18px 40px rgba(0,0,0,.35);animation:cks-pop .18s ease-out;z-index:5;cursor:pointer;user-select:none;pointer-events:auto;white-space:pre-line;}
.cks-bubble.cks-below{bottom:auto;top:calc(100% + 18px);}
.cks-bubble.cks-align-left{right:auto;left:0;}
.cks-bubble::before{content:'';position:absolute;left:56%;bottom:-22px;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-top:23px solid #101418;transform:rotate(7deg);z-index:0;}
.cks-bubble::after{content:'';position:absolute;left:56%;bottom:-17px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:18px solid #fffdf6;transform:rotate(7deg);z-index:1;}
.cks-bubble.cks-below::before{bottom:auto;top:-22px;border-top:0;border-bottom:23px solid #101418;}
.cks-bubble.cks-below::after{bottom:auto;top:-17px;border-top:0;border-bottom:18px solid #fffdf6;}
.cks-bubble.cks-align-left::before,.cks-bubble.cks-align-left::after{left:52%;}
.cks-menu{position:absolute;right:0;bottom:calc(100% + 10px);width:232px;background:#0b1118;border:1px solid #2c3a49;border-radius:12px;padding:8px;color:#dbe6f0;box-shadow:0 18px 46px rgba(0,0,0,.65);z-index:6;pointer-events:auto;}
.cks-menu.cks-below{bottom:auto;top:calc(100% + 10px);}
.cks-menu.cks-align-left{right:auto;left:0;}
.cks-menu-title{font-size:10px;letter-spacing:.12em;color:#7dffb0;opacity:.85;padding:4px 8px 7px;}
.cks-menu-item{display:block;width:100%;text-align:left;background:transparent;border:0;color:#dbe6f0;font:inherit;font-size:13px;padding:7px 8px;border-radius:7px;cursor:pointer;}
.cks-menu-item:hover{background:#16202b;}
.cks-menu-sep{height:1px;background:#1d2833;margin:6px 4px;}
.cks-menu-label{font-size:11px;color:#8da0b4;padding:2px 8px 6px;}
.cks-presets{display:flex;flex-wrap:wrap;gap:5px;padding:0 4px 4px;}
.cks-preset{border:1px solid #26323f;background:#0f1620;color:#c8d5e2;font:inherit;font-size:11px;padding:4px 7px;border-radius:6px;cursor:pointer;}
.cks-preset:hover{border-color:#7dffb0;}
.cks-preset.is-active{background:#123327;border-color:#7dffb0;color:#7dffb0;}
.cks-menu-foot{font-size:10px;color:#77889a;line-height:1.45;padding:6px 8px 2px;border-top:1px solid #1d2833;margin-top:6px;word-break:break-all;}
.cks-fx{position:fixed;inset:0;pointer-events:none;z-index:2147483100;overflow:hidden;}
.cks-event-text{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;background:none;border:none;box-shadow:none;padding:0;max-width:88vw;color:#fff6d8;font-size:clamp(30px,4.6vw,64px);font-weight:900;line-height:1.16;letter-spacing:.05em;text-align:center;text-shadow:0 3px 0 rgba(0,0,0,.45),0 0 30px rgba(0,0,0,.55);white-space:normal;pointer-events:none;animation:cks-event-text-in .45s cubic-bezier(.2,.9,.2,1) both;}
.cks-event-text.is-gold{color:#ffe28a;text-shadow:0 3px 0 rgba(90,48,0,.55),0 0 34px rgba(255,209,80,.6),0 0 60px rgba(255,190,40,.35);}
.cks-event-text.is-flood{color:#fff6cf;text-shadow:0 3px 0 rgba(60,35,0,.55),0 0 28px rgba(255,222,110,.65),0 0 60px rgba(160,100,10,.5);}
.cks-bill{position:fixed;bottom:-100px;z-index:2;filter:drop-shadow(0 12px 18px rgba(0,0,0,.36));animation-name:cks-bill-float;animation-timing-function:linear;animation-fill-mode:forwards;will-change:transform,opacity;}
.cks-bill img{display:block;width:100%;height:auto;border-radius:2px;pointer-events:none;user-select:none;-webkit-user-drag:none;}
.cks-flood{position:absolute;inset:0;overflow:hidden;z-index:1;pointer-events:none;background:radial-gradient(140% 90% at 15% 110%,rgba(255,221,96,.9) 0%,rgba(255,206,57,.42) 38%,rgba(255,206,57,0) 70%),radial-gradient(120% 80% at 90% 105%,rgba(236,178,34,.9) 0%,rgba(205,135,16,.45) 45%,rgba(205,135,16,0) 75%),linear-gradient(180deg,rgba(255,235,150,0) 0%,rgba(255,217,92,.22) 30%,rgba(222,160,28,.6) 68%,rgba(130,84,8,.9) 100%);animation:cks-flood-in .9s ease-out both;}
.cks-flood::before{content:'';position:absolute;left:-25%;right:-25%;top:42%;height:65%;background:linear-gradient(180deg,rgba(255,244,190,.38),rgba(220,155,20,.16) 42%,rgba(220,155,20,0) 72%);border-radius:45% 55% 0 0;filter:blur(8px);animation:cks-wave 5.2s ease-in-out infinite alternate;}
.cks-flood::after{content:'';position:absolute;left:-30%;right:-30%;bottom:-10%;height:75%;background:repeating-linear-gradient(105deg,rgba(255,250,210,.28) 0 10px,rgba(255,255,255,0) 10px 34px);background-size:150px 100%;opacity:.55;animation:cks-flow 1.2s linear infinite;border-radius:48% 52% 0 0;}
.cks-flood-wave{position:absolute;left:-25%;right:-25%;height:42%;border-radius:45% 55% 0 0/34% 38% 0 0;background:radial-gradient(ellipse at 50% 100%,rgba(255,238,150,.95) 0%,rgba(247,198,55,.88) 40%,rgba(214,148,20,.42) 70%,rgba(214,148,20,0) 84%);filter:blur(1.2px);box-shadow:0 -6px 18px rgba(255,232,130,.28);animation:cks-wave 4.2s ease-in-out infinite alternate;z-index:1;}
.cks-finale-stage{position:fixed;inset:0;z-index:2147483100;background:#05080c;overflow:hidden;}
.cks-scramble{position:absolute;inset:0;width:100%;height:100%;display:block;}
.cks-finale-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7dffb0;font-family:ui-monospace,monospace;font-size:15px;letter-spacing:.15em;background:#05080c;}
.cks-finale-avatar-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 120% at 50% 40%,#10161f 0%,#05080c 70%);animation:cks-avatar-in .42s steps(5,end) both;}
.cks-finale-avatar{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:cover;filter:contrast(1.02) saturate(.9);image-rendering:auto;}
.cks-finale-title{position:absolute;top:8vh;left:50%;transform:translateX(-50%);color:#dff7ea;font-size:clamp(28px,6vw,72px);letter-spacing:.25em;font-weight:800;text-shadow:0 0 24px rgba(125,255,176,.35),0 6px 0 rgba(0,0,0,.35);white-space:nowrap;}
.cks-finale-sub{position:absolute;bottom:14vh;left:50%;transform:translateX(-50%);color:#9fe6c2;font-size:clamp(12px,1.6vw,16px);letter-spacing:.08em;white-space:nowrap;background:rgba(5,10,14,.6);padding:8px 14px;border-radius:999px;border:1px solid rgba(125,255,176,.28);}
.cks-defeat .cks-finale-avatar{animation:cks-defeat .9s ease-in both;}
.cks-finale-widget{animation:cks-finale-bob 1.1s ease-in-out infinite;}
.cks-modal-mask{position:fixed;inset:0;background:rgba(2,5,8,.72);z-index:2147483300;display:flex;align-items:center;justify-content:center;pointer-events:auto;backdrop-filter:blur(3px);}
.cks-modal{width:min(90vw,340px);background:#0b1118;border:1px solid #2c3a49;border-radius:16px;padding:18px;color:#dbe6f0;box-shadow:0 24px 60px rgba(0,0,0,.7);text-align:center;}
.cks-modal-title{font-size:16px;letter-spacing:.08em;color:#7dffb0;margin-bottom:12px;}
.cks-qr{width:min(64vw,240px);height:auto;border-radius:10px;background:#fff;padding:8px;image-rendering:auto;}
.cks-modal-text{font-size:13px;line-height:1.66;color:#c8d5e2;margin-top:12px;text-align:left;white-space:pre-wrap;}
.cks-modal-small{font-size:11px;line-height:1.6;color:#7f90a3;margin-top:10px;text-align:left;word-break:break-all;}
.cks-modal-close{margin-top:16px;width:100%;background:#123327;border:1px solid #7dffb0;color:#7dffb0;border-radius:9px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;}
.cks-modal-close:hover{background:#17452f;}
@keyframes cks-pop{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes cks-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes cks-bill-float{0%{transform:translateY(0) rotate(0deg);opacity:0}10%{opacity:1}72%{opacity:.98}100%{transform:translateY(-132vh) rotate(22deg);opacity:0}}
@keyframes cks-event-text-in{from{opacity:0;transform:translate(-50%,-46%) scale(.94)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes cks-flood-in{from{opacity:0;transform:translateY(16%)}to{opacity:1;transform:none}}
@keyframes cks-flow{from{background-position:0 0}to{background-position:160px 0}}
@keyframes cks-wave{0%{transform:translateX(-6%) translateY(9%) scaleY(.92)}100%{transform:translateX(6%) translateY(0) scaleY(1.06)}}
@keyframes cks-avatar-in{from{transform:scale(1.06);opacity:.25;filter:blur(6px) contrast(1.5)}to{transform:scale(1);opacity:1;filter:blur(0) contrast(1.02)}}
@keyframes cks-defeat{0%{transform:scale(1);opacity:1}35%{transform:scale(1.02) rotate(-1.5deg);opacity:.9}100%{transform:scale(.92) rotate(2deg);opacity:0}}
@keyframes cks-finale-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes cks-run{0%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}100%{transform:rotate(-2deg)}}
@keyframes cks-sway{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
.cks-event-run .cks-device{animation:cks-run .36s linear infinite;}
.cks-event-balloon .cks-device{animation:cks-sway 2.2s ease-in-out infinite;}
.cks-event-block .cks-device{box-shadow:0 0 0 8px rgba(125,255,176,.12),0 30px 80px rgba(0,0,0,.8);}
.cks-dragging .cks-device{box-shadow:0 24px 60px rgba(0,0,0,.7);}
@media (prefers-reduced-motion: reduce){.cks-widget,.cks-device,.cks-bubble,.cks-finale-avatar-wrap{animation:none !important;transition:none !important}}

/* —— 无边框 Q 版挂件 / 金元券小标签 / 像素显现 —— */
.cks-widget{width:196px;align-items:center;gap:0;}
.cks-figure{width:100%;filter:drop-shadow(0 12px 18px rgba(0,0,0,.42));transition:filter .2s ease;pointer-events:none;}
.cks-figure img{display:block;width:100%;height:auto;pointer-events:none;user-select:none;-webkit-user-drag:none;}
.cks-money{margin-top:-6px;display:flex;align-items:baseline;gap:6px;padding:3px 10px;border-radius:999px;background:rgba(8,14,20,.72);border:1px solid rgba(125,255,176,.35);box-shadow:0 8px 20px rgba(0,0,0,.4);backdrop-filter:blur(5px);color:#7dffb0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.03em;white-space:nowrap;pointer-events:none;}
.cks-money-label{font-size:9.5px;opacity:.72;}
.cks-money-amount{font-size:12px;font-weight:700;text-shadow:0 0 8px rgba(125,255,176,.5);}
.cks-money-dot{width:5px;height:5px;border-radius:50%;background:#4f6b5b;margin-left:1px;}
.cks-money-dot[data-state="ok"]{background:#7dffb0;box-shadow:0 0 7px rgba(125,255,176,.8);}
.cks-money-dot[data-state="error"]{background:#ff7777;box-shadow:0 0 7px rgba(255,119,119,.6);}
.cks-quiet .cks-money-label{color:#ffd479;opacity:1;}
.cks-quiet{border-color:rgba(255,212,121,.35);color:#ffd479;}
.cks-defeat-hint{margin-top:6px;color:#ffd479;font-size:11px;letter-spacing:.03em;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.6);animation:cks-pulse 1s infinite;pointer-events:none;}
.cks-event-run .cks-figure{animation:cks-run .36s linear infinite;}
.cks-event-balloon .cks-figure{animation:cks-sway 2.2s ease-in-out infinite;}
.cks-event-block .cks-figure{filter:drop-shadow(0 0 18px rgba(125,255,176,.28)) drop-shadow(0 26px 46px rgba(0,0,0,.72));}
.cks-dragging .cks-figure{filter:drop-shadow(0 22px 34px rgba(0,0,0,.6));}
.cks-switch-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.cks-switch{min-width:38px;text-align:center;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid #3a4655;color:#9fb0c2;background:#0d141c;}
.cks-switch.is-on{border-color:#7dffb0;color:#082418;background:#7dffb0;font-weight:700;}
.cks-finale-stage{background:#05080c;}
.cks-morph-wrap{position:absolute;inset:0;overflow:hidden;background:#05080c;}
.cks-morph-canvas{position:absolute;inset:0;display:block;width:100%!important;height:100%!important;}
.cks-finale-osd{position:absolute;left:50%;top:3.2vh;transform:translateX(-50%);padding:5px 12px;border-radius:999px;background:rgba(3,8,12,.72);border:1px solid rgba(125,255,176,.3);color:#8ff5c4;font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.12em;white-space:nowrap;pointer-events:none;z-index:3;}
.cks-defeating .cks-morph-wrap{animation:cks-defeat .9s ease-in both;transform-origin:center;}
.cks-defeating .cks-finale-osd{opacity:0;transition:opacity .2s;}
`

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'chang-kaishen',
              order: 120,
              label: '常凯申挂件',
            },
            ChangKaiShenWidgetGuarded,
          ),
        )
      },
    }
  },
})
