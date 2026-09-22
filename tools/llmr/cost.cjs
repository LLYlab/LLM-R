'use strict'
// 一次运行的成本画像。
//
// 为什么要有这个：LLM-R 的主张是 **cheap / stable / quick**，但主张不是证据。
// 这个模块把"省在哪"变成能打印、能断言、能对比的数字——
// 否则"省 token"只是一句口号，谁都可以说。
//
// 三个量是**可算的**：
//   ① 模型调用次数   —— 跑了几个 AMZ。少跑一个就是少一次调用。
//   ② 工具面开销     —— 通用 agent 每次调用都背着**整张工具表**；
//                       LLM-R 每个容器只背自己那几个。把差值算出来。
//   ③ 手写的确定性判定 —— 边上只用 artifact./run./args. 的判定**不需要模型参与**。
//                       这些是白拿的：通用 agent 每次都要花 token 重新决定"下一步干嘛"。

const { asArray, asObject } = require('./loader.cjs')
const expr = require('./expression.cjs')

const DETERMINISTIC = ['artifact', 'run', 'args']

/**
 * @param {object} swf     声明（已归一）
 * @param {object} result  executeSwf 的返回值
 * @returns {object} 成本画像
 */
function costOf (swf, result) {
  const r = asObject(result)
  const trace = asArray(r.trace)

  const amzList = asArray(asObject(swf).amz).filter((a) => asObject(a).id !== undefined)
  const declared = new Map()
  for (const a of amzList) {
    const o = asObject(a)
    declared.set(o.id, { tools: asArray(o.tools).length })
  }

  // 图里出现过的所有工具名（通用 agent 的那张"整表"）
  const allTools = new Set()
  for (const a of amzList) for (const t of asArray(asObject(a).tools)) allTools.add(t)

  const order = asArray(asObject(swf).order)
  const edgeLevel = new Map()
  for (const e of order) {
    const o = asObject(e)
    edgeLevel.set(o.from + '\u0000' + (o.to === undefined ? '' : o.to), o.when)
  }

  let calls = 0
  let pauseSteps = 0
  let poolSteps = 0
  let deterministicEdges = 0
  let modelEdges = 0
  let llmrSurface = 0
  const reached = new Set()
  const byAmz = {}

  for (const s0 of trace) {
    const s = asObject(s0)
    const id = s.amz
    reached.add(id)
    const n = declared.has(id) ? declared.get(id).tools : 0
    if (!byAmz[id]) byAmz[id] = { calls: 0, tools: n, pool: false }

    if (s.via === 'pause') pauseSteps++   // 暂停那一步不花模型，但下面的边照算
    else calls++
    if (s.via !== 'pause') { byAmz[id].calls++; llmrSurface += n }
    if (s.pool !== undefined) { poolSteps++; byAmz[id].pool = true }

    // 这一步选的边是确定性判定还是模型判定
    if (s.to !== undefined) {
      const when = edgeLevel.get(id + '\u0000' + s.to)
      if (typeof when === 'string') {
        let ns = null
        try { ns = expr.namespacesOf(expr.parse(when)) } catch (_) { ns = null }
        if (ns && ns.size > 0 && [...ns].every((x) => DETERMINISTIC.includes(x))) deterministicEdges++
        else modelEdges++
      } else {
        modelEdges++   // else 兜底：上游的判定已经花过模型了
      }
    }
  }

  // 图里声明了、但这次没走到的 AMZ —— 省下来的调用
  const skipped = []
  const poolIds = new Set()
  for (const z of asArray(asObject(swf).pool)) for (const x of asArray(asObject(z).run)) poolIds.add(x)
  for (const a of amzList) {
    const id = asObject(a).id
    if (!reached.has(id)) skipped.push(id)
  }

  // 工具面：两种账
  const flatPerCall = allTools.size
  return {
    // ① 调用
    calls,
    pauseSteps,
    poolSteps,
    // ② 工具面
    surface: {
      llmr: llmrSurface,                       // 本次实际背过的工具条数（各容器各背各的）
      flatPerCall,                             // 通用 agent 每次调用要背的整表
      flatTotal: flatPerCall * Math.max(1, calls),
      saved: Math.max(0, flatPerCall * Math.max(1, calls) - llmrSurface),
      toolsInGraph: allTools.size,
    },
    // ③ 判定
    deterministicEdges,
    modelEdges,
    // ④ 没走到的
    skipped,
    skippedCount: skipped.length,
    reachedCount: reached.size,
    declaredCount: declared.size,
    poolZones: poolIds.size,
    byAmz,
    status: r.status,
    ok: r.ok === true,
  }
}

/** 一行摘要，给 CLI / 界面 */
function formatCost (c0) {
  const c = asObject(c0)
  const s = asObject(c.surface)
  const lines = [
    `模型调用 ${c.calls} 次` + (c.pauseSteps ? `（另有 ${c.pauseSteps} 次暂停，不花模型）` : ''),
    `走到了 ${c.reachedCount}/${c.declaredCount} 个容器，跳过 ${c.skippedCount} 个` +
      (c.skippedCount ? `：${asArray(c.skipped).join(', ')}` : ''),
    `确定性判定 ${c.deterministicEdges} 次 · 依赖模型的判定 ${c.modelEdges} 次`,
    `工具面：LLM-R 实际背 ${s.llmr} 条 · 整表口径 ${s.flatPerCall}×${Math.max(1, c.calls)}=${s.flatTotal} 条` +
      ` → 省 ${s.saved} 条`,
  ]
  if (c.poolSteps) lines.push(`环控区里跑了 ${c.poolSteps} 步`)
  return lines.join('\n')
}

module.exports = { costOf, formatCost }
