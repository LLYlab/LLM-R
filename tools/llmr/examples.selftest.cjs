#!/usr/bin/env node
'use strict'
// 模拟真人跑这五张 example —— 而且**换五种"模型性格"各跑一遍**。
//
// 为什么这么测：LLM-R 的主张是 cheap / stable / quick，但主张不是证据。
// 一个只在"模型很听话"时跑得通的流程，等于没测。真人的模型会：
//   ① 老实       按声明报，语义也对
//   ② 闷葫芦     压根不提信号块
//   ③ 类型错     报了，但 bool 给成 "yes"
//   ④ 撒谎       报了、类型也对，但语义错（build_ok 永远 true）
//   ⑤ 罢工       每一步都失败
//
// 要证明的是：**后四种也不会让流程跑偏**。这是"stable"的真正含义——
// 不是"模型不会说谎"，是"模型说谎时流程也只在设计好的格子里走"。
//
// 用法：node tools/llmr/examples.selftest.cjs

const fs = require('node:fs')
const path = require('node:path')
const loader = require('./loader.cjs')
const { executeSwf } = require('./executor.cjs')
const { costOf } = require('./cost.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++ } else { fail++; console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`) }
}

/** 脚本化后端：按"性格"决定每个 AMZ 报什么 */
function personality (swf, mode, honestMap) {
  const declared = new Map()
  for (const a of swf.amz) {
    if (!a || typeof a.id !== 'string') continue
    declared.set(a.id, Object.keys((a.output && a.output.signal && a.output.signal.fields) || {}))
  }
  return {
    name: 'persona:' + mode,
    async call ({ amz }) {
      const id = amz.id
      if (mode === '罢工') return { ok: false, meta: { error: '模型罢工了' } }
      const fields = declared.get(id) || []
      const sig = {}
      // ① 老实：按类型给合理值，再用 honestMap 覆盖成"语义正确"
      for (const f of fields) {
        const t = amz.output.signal.fields[f]
        if (mode === '撒谎') sig[f] = t === 'int' ? 9 : (t === 'bool' ? true : 'x')
        else if (mode === '类型错') sig[f] = 'yes'            // bool 给成字符串
        else if (mode === '闷葫芦') { /* 什么都不报 */ }
        else sig[f] = t === 'int' ? 3 : (t === 'bool' ? true : 'x')
      }
      if (mode === '老实' && honestMap[id]) Object.assign(sig, honestMap[id])
      return { ok: true, output: `[${amz.output.body}] ${id}`, signal: sig }
    },
  }
}

const run = (swf, mode, c, extra) => executeSwf(swf, Object.assign({
  backend: personality(swf, mode, c.honest || {}),
  args: c.args || {},
  events: c.events || {},
  amzLibrary: {},
}, extra || {}))

// ══════════ 五张 example 的"真人剧本" ══════════
const CASES = [
  {
    file: 'coding-auto-run.swf.json',
    args: { repo: 'C:/demo', goal: '把 Channel 抽成通用接口' },
    honest: { recon: { need_clarify: false, working: true }, plan: { plan_ok: true, working: true }, verify: { build_ok: true, working: true } },
    // 诚实模型下应当**跳过**这两条支路 —— 这就是 cheap：不跑 = 不花
    mustSkip: ['clarify', 'give_up'],
  },
  {
    file: 'coding-help.swf.json',
    args: { repo: 'C:/demo', goal: '读写分离，调用方一行不改' },
    events: { ask: true },
    honest: {},
    mustSkip: ['explain', 'suggest', 'revisit'],   // 四个监听器只该触发被请求的那一个
    mustReach: ['answer'],
  },
  {
    file: 'coding-draft.swf.json',
    args: { target: 'src/channel.ts' },
    honest: { scan: { region_count: 3 }, fill: { region_done: 3 }, verify: { ok: true } },
    mustSkip: ['no_region', 'rework'],
    mustReach: ['apply', 'report'],
  },
  {
    file: 'story-novel.swf.json',
    args: { task: 'new_chapter', chapter: '3' },
    honest: { route: { task: 'new_chapter' }, gen_chapter: { chapter_ok: true } },
    mustSkip: ['gen_outline', 'gen_revise'],       // 三条任务支路只走一条
    mustReach: ['distill', 'persist'],
  },
  {
    file: 'skill-to-swf.swf.json',
    args: { skill: '---\nname: 我的技能\ndescription: 把会议纪要整理成行动项\n---\n1. 读纪要\n2. 抽行动项\n3. 发出去' },
    honest: { read_skill: { usable: true, steps: 3 }, judge_shape: { shape: 'flow', drafting: true }, self_check: { clean: true, errors: 0 } },
    mustSkip: ['not_usable', 'refine'],       // 文档够用就不走"不可用"，校验一遍过就不纠错
    mustReach: ['draft_swf', 'deliver', 'guide'],
  },
  {
    file: 'story-dnd.swf.json',
    args: { campaign: '迷雾矿坑', action: '我推门进去' },
    events: { player_action: true },
    honest: {},
    mustReach: ['judge', 'narrate', 'save'],
  },
]

async function main () {
console.log('LLM-R · example 真人模拟（五种模型性格）')
console.log('═'.repeat(76))

for (const c of CASES) {
  const p = loader.prepare(path.join(ROOT, 'swfs', c.file))
  if (p.problems) { console.log(`\n${c.file}\n  ✗ 声明加载失败`); fail++; continue }
  const swf = p.swf
  console.log(`\n▌ ${swf.title || c.file}   (${swf.id})`)

  // ── ① 老实 ──
  const honest = await run(swf, '老实', c)
  const cost = costOf(swf, honest)
  const reached = new Set(honest.trace.map((s) => s.amz))
  const declaredN = swf.amz.filter((a) => a && a.id).length

  console.log(`  老实     ${honest.status.padEnd(10)} ${String(honest.trace.length).padStart(2)} 步  ` +
    `走到 ${cost.reachedCount}/${declaredN} 容器 · 跳过 ${cost.skippedCount} 个 · ` +
    `工具面 ${cost.surface.llmr} 条（整表口径 ${cost.surface.flatTotal}）· 确定性判定 ${cost.deterministicEdges} 次`)

  ok(`${swf.id} 老实：有停在明确的状态`, ['completed', 'paused', 'stopped'].includes(honest.status), honest.status)
  ok(`${swf.id} 老实：确实剪掉了支路（cheap 的证据）`, cost.skippedCount > 0, `跳过 ${cost.skippedCount} 个`)
  for (const id of c.mustSkip || []) {
    ok(`${swf.id} 老实：跳过了 ${id}`, !reached.has(id))
  }
  for (const id of c.mustReach || []) {
    ok(`${swf.id} 老实：走到了 ${id}`, reached.has(id), [...reached].join(', '))
  }

  // ── ②③④⑤ 四种坏模型：**不许崩、不许跑偏、不许无限** ──
  for (const mode of ['闷葫芦', '类型错', '撒谎', '罢工']) {
    let r
    try { r = await run(swf, mode, c) } catch (e) {
      ok(`${swf.id} ${mode}：不许抛异常`, false, String(e && e.message ? e.message : e))
      continue
    }
    const seen = r.trace.map((s) => s.amz)
    const outOfGraph = seen.filter((x) => !swf.amz.some((a) => a && a.id === x))
    const bounded = seen.length <= 64
    const terminalish = ['completed', 'paused', 'stopped', 'error'].includes(r.status)

    ok(`${swf.id} ${mode}：不抛异常`, true)
    ok(`${swf.id} ${mode}：只在声明的容器里走`, outOfGraph.length === 0, outOfGraph.join(','))
    ok(`${swf.id} ${mode}：步数有界（不空转）`, bounded, `${seen.length} 步`)
    ok(`${swf.id} ${mode}：停在明确的状态`, terminalish, r.status)
    console.log(`  ${mode.padEnd(6)} ${r.status.padEnd(10)} ${String(r.trace.length).padStart(2)} 步  ${seen.slice(0, 6).join(' → ')}${seen.length > 6 ? ' → …' : ''}`)
  }
}

// ══════════ 环控区：允许环，但必须有界 ══════════
console.log('\n▌ 环控区（允许环 ≠ 允许跑不完）')
{
  // 自愈：构建一直挂 —— 池必须恰好跑 maxRounds 轮就停
  const p = loader.prepare(path.join(ROOT, 'swfs', 'coding-auto-run.swf.json'))
  const r = await executeSwf(p.swf, {
    backend: personality(p.swf, '老实', { recon: { need_clarify: false, working: true }, plan: { plan_ok: true, working: true }, verify: { build_ok: false, working: true } }),
    args: {}, amzLibrary: {},
  })
  const rounds = r.poolRounds && r.poolRounds.self_heal
  const poolSteps = r.trace.filter((s) => s.pool).length
  console.log(`  构建一直挂   ${r.status.padEnd(10)} 自愈 ${rounds} 轮 · 池内 ${poolSteps} 步 · 主流程 ${r.trace.filter((s) => !s.pool).length} 步`)
  ok('环控区：maxRounds=3 恰好跑 3 轮', rounds === 3, String(rounds))
  ok('环控区：池内步数 = 3 轮 × 2 个节点', poolSteps === 6, String(poolSteps))
  ok('环控区：跑满了就停，不无限', r.trace.length < 64, String(r.trace.length))
}

console.log('\n' + '═'.repeat(76))
console.log(`真人模拟：${pass} 通过 / ${fail} 失败`)
process.exitCode = fail ? 1 : 0
}

main().catch((e) => { console.error('真人模拟异常：' + (e && e.stack ? e.stack : e)); process.exit(1) })
