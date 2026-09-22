#!/usr/bin/env node
'use strict'
// 人机工学审计：把**真正的 webui.html** 加载起来，让一段脚本去量 DOM。
//
// 为什么这么做：界面好不好用不该靠嘴说。这里量的是能判对错的硬指标——
// 点击目标够不够大、输入框有没有标签、要路径的地方能不能点着选、
// 缺前置条件时有没有被拦下并说人话、完成一件典型事情要点几下。
//
// 做法：把 boot() 换成「摆好某个状态」，再注入审计脚本，把结果写进 <pre id="__ux">。
// 然后用无头 Edge 的 --dump-dom 把它捞出来。
//
// 用法：
//   node tools/llmr/uxaudit.cjs              # 生成 _shot/ux-*.html
//   node tools/llmr/uxaudit.cjs --report     # 顺带跑 Edge 并把报告打出来

const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(__dirname, 'webui.html')
const OUT = path.join(ROOT, '_shot')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const SWF_HOMEWORK = path.join(ROOT, 'swfs', 'homework.swf.json')
const SWF_AUTORUN = path.join(ROOT, 'swfs', 'coding-auto-run.swf.json')

const A = (name, swf, purpose) => ({ id: 'a-' + name, name, swf, purpose, createdAt: 0 })

const AGTS = [
  A('作业成品', SWF_HOMEWORK, '把一份作业 PDF 做成 Word 成品'),
  A('自动改代码', SWF_AUTORUN, '你只说清要什么，不看中间源码'),
]

// ── 审计脚本：在页面里跑，量 DOM ──
const AUDIT = `
(function () {
  var R = { state: __STATE__, findings: [], counts: {} }
  var $ = function (s) { return document.querySelector(s) }
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)) }
  var vis = function (el) {
    var r = el.getBoundingClientRect()
    if (!r.width && !r.height) return null
    var st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return null
    // 折在**关着的** <details> 里 = 用户看不见。无头下这种元素仍有尺寸，得自己判。
    var d = el.closest && el.closest('details')
    if (d && !d.hasAttribute('open')) return null
    return r
  }
  var name = function (el) {
    var t = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 14)
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (t ? '「' + t + '」' : '')
  }
  var F = function (level, what, detail) { R.findings.push({ level: level, what: what, detail: detail }) }

  // ── 1. 点击目标够不够大（WCAG 2.5.8 最小 24×24；这里按 28 更舒服） ──
  var clickable = $$('button, a, [data-agt], [data-swf], .row, .chip, [role=button]')
  var small = []
  clickable.forEach(function (el) {
    var r = vis(el); if (!r) return
    if (r.height < 28 || r.width < 28) small.push(name(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height))
  })
  R.counts.clickable = clickable.filter(function (e) { return vis(e) }).length
  if (small.length) F('warn', '点击目标偏小（< 28px）', small.slice(0, 6).join('；'))

  // ── 2. 输入框有没有标签 ──
  var inputs = $$('input:not([type=hidden]), textarea, select')
  var unlabeled = []
  inputs.forEach(function (el) {
    var r = vis(el); if (!r) return
    var has = (el.labels && el.labels.length) ||
      (el.id && document.querySelector('label[for="' + el.id + '"]')) ||
      el.closest('label') ||
      (el.getAttribute('aria-label'))
    // 也认"紧邻上方的 label.f"这类常见写法
    if (!has) {
      var p = el.previousElementSibling
      while (p && !/label/i.test(p.tagName)) { if (p.tagName === 'DIV' || p.tagName === 'SECTION') break; p = p.previousElementSibling }
      if (!p || !/label/i.test(p.tagName)) unlabeled.push(name(el) + ' ph=' + (el.placeholder || '—'))
    }
  })
  R.counts.inputs = inputs.length
  if (unlabeled.length) F('warn', '输入框没有关联标签', unlabeled.slice(0, 6).join('；'))

  // ── 3. 要路径的地方能不能「点着选」 ──
  var PATHY = /(path|dir|folder|file|repo|pdf|target|campaign|skill|src)/i
  var noPicker = []
  inputs.forEach(function (el) {
    var r = vis(el); if (!r) return
    var hint = (el.getAttribute('data-arg') || '') + ' ' + (el.placeholder || '')
    if (!PATHY.test(hint)) return
    // 同一个容器里有没有"选…"这类按钮
    // 必须和输入框在**同一行**才算数 —— 用父容器会把隔壁行的按钮也算进来
    var line = el.closest('.rowline') || el.parentElement
    var btn = line && line.querySelector('button[data-pick], .pick')
    if (!btn) noPicker.push(el.getAttribute('data-arg') || el.placeholder)
  })
  if (noPicker.length) F('err', '要填路径但没有「选…」按钮（傻瓜不知道路径怎么写）', noPicker.join('、'))

  // ── 4. 起点的下一步清不清楚 ──
  var hero = $('.hero')
  if (hero) {
    var box = $('.hero input') || $('.askbox input')
    var send = $('.hero .send') || $('.askbox .send')
    if (!box) F('err', '首屏没有输入框', '用户不知道从哪儿开始')
    if (!send) F('err', '首屏没有提交按钮', '')
  }

  // ── 5. 缺前置条件时，有没有被拦下并说人话 ──
  var foot = $('#sideFoot')
  if (foot && /未配置/.test(foot.textContent || '')) {
    var runBtn = $('#btnRun')
    if (runBtn && !runBtn.disabled) {
      F('warn', '缺模型 API 时「开始」仍可点', '应该拦住并给一条人话的下一步，而不是点下去才报错')
    }
    var link = foot.querySelector('a')
    if (!link) F('warn', '提示了「未配置」却没有可点的去处', '')
  }

  // ── 6. 完成一件典型事要点几下 ──
  var rows = $$('[data-agt]')
  if (rows.length) {
    var inputsVisible = inputs.filter(function (e) { return vis(e) }).length
    R.counts.typicalClicks = 1 /* 选 AGT */ + inputsVisible + 1 /* 开始 */
    if (inputsVisible > 3) F('warn', '典型任务要填的字段偏多', inputsVisible + ' 个输入框')
  }

  // ── 7. 高级入口：可达，但不挡路 ──
  var hasDev = !!($('#modes') && /开发者/.test($('#modes').textContent || ''))
  R.counts.advancedEntry = hasDev ? '顶栏并列' : '（无）'
  if (hasDev) F('info', '开发者模式与用户模式**并列在顶栏**', '对傻瓜来说这是个需要理解的选择；更好的做法是收进「高级」')

  // ── 8. 错误文案里有没有技术术语 ──
  // ⚠ body.textContent 把 <script> 的源码也算进去了 —— 那是假警报。
  //   只扫可见文字。
  var clone = document.body.cloneNode(true)
  Array.prototype.slice.call(clone.querySelectorAll('script,style')).forEach(function (n) { n.remove() })
  var body = clone.textContent || ''
  var jargon = []
  for (const re of [/\bundefined\b/, /\bnull\b/, /\bNaN\b/, /LLMR-[EW]\d{3}/, /\bHTTP \d{3}\b/, /\\{\s*"/]) {
    var m = body.match(re); if (m) jargon.push(m[0])
  }
  if (jargon.length) F('warn', '界面上出现了技术术语', jargon.join('、'))

  // ── 9. 焦点可见（查样式表里有没有 :focus 规则） ──
  var hasFocus = false
  try {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rs = document.styleSheets[i].cssRules || []
      for (var j = 0; j < rs.length; j++) {
        if (rs[j].selectorText && /:focus/.test(rs[j].selectorText)) { hasFocus = true; break }
      }
      if (hasFocus) break
    }
  } catch (e) {}
  if (!hasFocus) F('warn', '没有 :focus 样式', '键盘用户看不出焦点在哪')

  R.summary = {
    errors: R.findings.filter(function (f) { return f.level === 'err' }).length,
    warns: R.findings.filter(function (f) { return f.level === 'warn' }).length,
    infos: R.findings.filter(function (f) { return f.level === 'info' }).length,
  }
  var pre = document.createElement('pre')
  pre.id = '__ux'
  pre.style.display = 'none'
  pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(R))))
  document.body.appendChild(pre)
})()
`

// ── 生成各状态的静态页 ──
function bootstrap (o) {
  const L = []
  L.push('  S.mode = ' + JSON.stringify(o.mode || 'user') + ';')
  L.push('  S.settings = ' + JSON.stringify(o.settings || { backend: 'echo', model: { hasKey: false } }) + ';')
  L.push('  S.agts = ' + JSON.stringify(AGTS) + ';')
  L.push('  S.list = { swfs: [{ name: "coding-auto-run.swf.json", path: ' + JSON.stringify(SWF_AUTORUN) + ' }], amz: [] };')
  if (o.agt !== undefined) L.push('  S.agt = ' + JSON.stringify(AGTS[o.agt]) + ';')
  if (o.panel) L.push('  S.panel = ' + JSON.stringify(o.panel) + ';')
  if (o.swfPath) L.push('  S.swfPath = ' + JSON.stringify(o.swfPath) + ';')
  if (o.view) L.push('  S.view = ' + JSON.stringify(o.view) + ';')
  L.push('  paint();')
  return L.join('\n')
}

const { runChecks } = require('../validator/checks.cjs')
const loader = require('./loader.cjs')
const prepared = loader.prepare(SWF_AUTORUN)
const checked = runChecks(prepared.swf, {})
const VIEW = { swf: prepared.swf, path: SWF_AUTORUN, errors: checked.errors || [], warnings: checked.warnings || [], surface: checked.surface || [] }

const STATES = {
  'hero': { mode: 'user', settings: { backend: 'echo', model: { hasKey: false } } },
  'agt-generic': { mode: 'user', settings: { backend: 'echo', model: { hasKey: false } }, agt: 0, view: { swf: JSON.parse(fs.readFileSync(SWF_HOMEWORK, 'utf8')).swf, path: SWF_HOMEWORK } },
  'settings': { mode: 'user', settings: { backend: 'echo', model: { hasKey: false } }, panel: 'settings' },
  'agt-ui': { mode: 'dev', settings: { backend: 'echo', model: { hasKey: true } }, swfPath: SWF_AUTORUN, view: VIEW },
}

const src = fs.readFileSync(SRC, 'utf8')
if (!src.includes('  boot()\n})()')) { console.error('webui.html 结构变了：找不到 IIFE 末尾的 boot()'); process.exit(1) }

const written = []
for (const [name, o] of Object.entries(STATES)) {
  const code = bootstrap(o) + '\n' + AUDIT.replace('__STATE__', JSON.stringify(name))
  const html = src.replace('  boot()\n})()', code + '\n})()')
    .replace('/__llmr/logo-mark.png', '../tools/llmr/logo-mark.png')
  const p = path.join(OUT, 'ux-' + name + '.html')
  fs.writeFileSync(p, html, 'utf8')
  written.push([name, p])
}
console.log(`✓ 生成 ${written.length} 个审计页：${written.map((w) => w[0]).join(', ')}`)

if (!process.argv.includes('--report')) return

// ── 跑 Edge，把报告捞回来 ──
let totalErr = 0
let totalWarn = 0
for (const [name, p] of written) {
  const r = cp.spawnSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1500',
    '--window-size=1440,900', '--dump-dom',
    'file:///' + p.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000 })
  const dom = r.stdout || ''
  const m = dom.match(/<pre id="__ux"[^>]*>([^<]*)<\/pre>/)
  if (!m) { console.log(`\n▌ ${name}\n  ✗ 没拿到报告（页面脚本可能抛了）`); totalErr++; continue }
  let R
  try { R = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) }
  catch (e) { console.log(`\n▌ ${name}\n  ✗ 报告解析失败`); totalErr++; continue }

  console.log(`\n▌ ${name}   （可点 ${R.counts.clickable} · 输入 ${R.counts.inputs}` +
    (R.counts.typicalClicks ? ` · 典型任务约 ${R.counts.typicalClicks} 下` : '') + `）`)
  if (!R.findings.length) console.log('  ✓ 没有发现问题')
  for (const f of R.findings) {
    const ico = f.level === 'err' ? '✗' : (f.level === 'warn' ? '!' : '·')
    console.log(`  ${ico} ${f.what}${f.detail ? '\n      ' + f.detail : ''}`)
  }
  totalErr += R.summary.errors
  totalWarn += R.summary.warns
}
console.log(`\n审计合计：${totalErr} 个硬伤 · ${totalWarn} 个提醒`)
