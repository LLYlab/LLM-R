# LLM-R 的 SWF 库

这里放**真实使用的流程**（不是 `verify/` 里那些测试夹具）。

| SWF | 干什么 | 界面 |
|---|---|---|
| `homework.swf.json` | 把一份作业 PDF 做成排版好看、公式可编辑的 Word | 通用表单 |
| `coding-auto-run` | 你只说清要什么，**不看中间源码** | 3 页 |
| `coding-help` | 先写 Goal 锚住，然后像 Copilot 边写边问——**它不改你的文件** | 3 页 |
| `coding-draft` | 在壳里写 `AI:` 指令，它把每段补成真代码 | 2 页 |
| `story-novel` | 大纲 / 新章 / 编辑渲染 / 亲自编辑 | 4 页 |
| `story-dnd` | AI 当 DM，回合循环走环控区 | 3 页 |
| `skill-to-swf` | 把 skill 文档转成 **SWF 草稿**（签名要人签） | 3 页 |

> SWF 自带界面的，目录名 = 声明里的 `swf.id`（如 `coding_auto_run/`），
> 因为 `/ui/<id>/...` 就按它找。**文件名**可以用连字符（`coding-auto-run.swf.json`），
> `id` 只许下划线。

---

## 三张 Coding 不是一条轴上的三档

它们是**三种「你和代码的关系」**：

| | 源码对你的可见性 | 谁做决定 | 你的输入 |
|---|---|---|---|
| **AutoRun** | **你看不到源码** | 它决定，你看结果 | 一句目标 |
| **Help** | **源码摆在正中央** | 你决定，它建议 | 先写 Goal，再边写边问 |
| **Draft** | **源码就是你的输入** | 你写骨架，它填肉 | 文件里的 `AI:` 标记 |

同一副骨架，三种界面。这就是「界面绑定工作种类」的字面兑现。

---

## 它们凭什么算便宜

不是形容词，是 `tools/llmr/examples.selftest.cjs` 打出来的数：

```
▌ 自动改代码 · Coding AutoRun
  老实     completed   6 步  走到 6/11 容器 · 跳过 5 个 · 工具面 7 条（整表口径 24）· 确定性判定 2 次
▌ 边写边问 · Coding Help
  老实     completed   4 步  走到 4/7 容器 · 跳过 3 个 · 工具面 6 条（整表口径 12）· 确定性判定 1 次
▌ 在文件里写指令 · Coding Draft
  老实     completed   5 步  走到 5/8 容器 · 跳过 3 个 · 工具面 7 条（整表口径 20）· 确定性判定 2 次
```

两笔账：

1. **跳过的容器** —— 图里声明了、这次没走的，就是**没花的调用**。AutoRun 有 11 个容器，
   老实跑只走 6 个。
2. **工具面** —— 通用 agent 每次调用都背着**整张工具表**；LLM-R 每个容器只背自己那几个。
   AutoRun 那次：实际背 7 条，整表口径要 24 条。

`run.cjs --report` 或结果页都能看到这笔账。

---

## 它们凭什么算稳

**不是"模型不会说谎"，是"模型说谎时流程也只在设计好的格子里走"。**

真人模拟拿五种模型性格各跑一遍：老实 / 闷葫芦（不报信号）/ 类型错 / 撒谎 / 罢工。

```
▌ 在文件里写指令 · Coding Draft
  老实     completed   5 步  scan → fill → apply → verify → report
  闷葫芦    completed   2 步  scan → no_region            ← 不提信号 → 走 else 兜底，不瞎跑
  类型错    completed   2 步  scan → no_region            ← bool 给成 "yes" → 判定不成立 → 兜底
  撒谎     completed   5 步  scan → fill → apply → verify → report
  罢工     completed   2 步  scan → no_region
```

注意 **撒谎那一行**：它照样跑完了。这不是"防住了撒谎"——是**流程没跑偏**。
LLM-R 的稳定来自固定图，不来自对模型的信任。要说清这个区别。

---

## 写 SWF 的一条纪律：`tags` 是匹配用的关键词通道

新建 AGT 时，用户那句话是拿 `tags` / `when` / `title` 去**关键词匹配**的。
所以 **`tags` 要写全别名**：中文、英文、同义词、用户可能说的口语说法。

> 匹配器是保守的（宁可说"不确定"也不假匹配）；**该修的是元数据**。

---

## 校验

```bash
node tools/validator/validate.cjs swfs/coding-auto-run.swf.json
```

带 `run_shell` 的容器会报 `LLMR-W201`（exec 类工具）——**那是校验器在正确工作**：
会话 sandbox 不是 per-AMZ 的，那几个盒子继承的是整个会话的 sandbox 模式。
要收紧就换更专用的工具，或者加 `guards` 限定参数。
