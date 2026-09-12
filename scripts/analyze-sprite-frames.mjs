/**
 * scripts/analyze-sprite-frames.mjs — 用 Edge+canvas 量化 action-board 帧质量（诊断用）
 * 输出：每帧四角 alpha、帧间像素差异比例
 */
import puppeteer from '../client/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const html = `<!doctype html><body><script>
window.analyze = async (files) => {
  const out = {}
  for (const name of Object.keys(files)) {
    const imgs = []
    for (const dataUrl of files[name]) {
      const img = new Image()
      img.src = dataUrl
      try { await img.decode().catch((e) => { throw new Error('decode fail: ' + e.message + ' len=' + dataUrl.length) }) }
      catch (e) { return { loadError: String(e) } }
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      imgs.push({ w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data })
    }
    const rows = []
    let prev = null
    for (const im of imgs) {
      const { w, h, data } = im
      const px = (x, y) => { const j = (y * w + x) * 4; return [data[j], data[j+1], data[j+2], data[j+3]] }
      const corners = [px(3,3), px(w-4,3), px(3,h-4), px(w-4,h-4)]
      let diff = 0, alphaZero = 0
      for (let j = 0; j < data.length; j += 4) {
        if (data[j+3] === 0) { alphaZero++; continue }
        if (prev) {
          const dj = Math.abs(data[j]-prev[j]) + Math.abs(data[j+1]-prev[j+1]) + Math.abs(data[j+2]-prev[j+2])
          if (dj > 60) diff++
        }
      }
      rows.push({ corners, diffPct: +(100*diff/(w*h)).toFixed(2), alphaZeroPct: +(100*alphaZero/(w*h)).toFixed(1) })
      prev = data
    }
    out[name] = { size: imgs[0].w + 'x' + imgs[0].h, frames: rows }
  }
  return out
}
</script></body>`

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: 'new' })
const page = await browser.newPage()
await page.setContent(html)

const files = {
  'tao-wave': [1, 2, 3, 4, 5].map((i) => join(ROOT, 'docs/assets/action-boards/tao', `tao_wave_0${i}.png`)),
  'tao-heart': [1, 2, 3, 4, 5].map((i) => join(ROOT, 'docs/assets/action-boards/tao', `tao_heart_0${i}.png`)),
  'jing-wave': [1, 2, 3, 4, 5].map((i) => join(ROOT, 'docs/assets/action-boards/jing', `girl_wave_0${i}.png`)),
  'jing-heart': [1, 2, 3, 4, 5].map((i) => join(ROOT, 'docs/assets/action-boards/jing', `girl_heart_0${i}.png`)),
}
const result = await page.evaluate((f) => window.analyze(f), files)
console.log(JSON.stringify(result, null, 1))
writeFileSync(join(ROOT, 'scripts', 'frame-analysis.json'), JSON.stringify(result, null, 2))
await browser.close()
