# 变更记录

## v0.2.0

### 加了

- **全局工具注册表** `tools/toolbox.json` —— 40 个工具、6 个类别、两种表面（AMZ / 界面）。
  校验器的"工具是否存在"与"属于哪一类"都从这里读：**可复用实现全局注册，SWF 只声明选用**。
- **本地接入** —— 图形化选文件 / 选目录 / 另存为 / 剪贴板 / 打开路径 / 资源管理器定位。
  SWF 的界面在 sandbox iframe 里**碰不到本机**，这类事只能由宿主代劳；
  参数走环境变量传进 PowerShell，不拼字符串。
- **成本画像** `tools/llmr/cost.cjs` —— 模型调用数 / 工具面开销 / 确定性判定数 / 跳过的容器。
  `run.cjs --report` 与结果页都会打。**"省 token"得是能打印的数字，不能是口号。**
- **真人模拟测试** `tools/llmr/examples.selftest.cjs` —— 六张 example × 五种模型性格
  （老实 / 闷葫芦 / 类型错 / 撒谎 / 罢工），133 项断言。
- **环控区 `after`** —— 监听器在某个节点跑过之后才武装。
- **六张 example SWF**：coding_auto_run / coding_help / coding_draft / story_novel / story_dnd /
  **skill_to_swf**（把 skill 文档转成 SWF 草稿）
- **双主题**：暗色 / 亮色 / 跟随系统。

### 改了

- `ui.page` 固定骨架 → `ui.screens` + **SWF 自带的 HTML**（决策 #10 重写）
- 环：从一律拒绝 → **允许，但必须进环控区**（`pool[]`，`LLMR-E113` 收窄到主流程）
- 校验器 17 → 19 项，错误码 23 → 27 个
- 产品改名 LLM-R；错误码前缀 `LLMR-`

### 修了（都靠真人模拟抓出来）

- `story_novel` 的 `dispatch` 把上游认定的 task **覆盖成垃圾**，三条任务分支全走错
  → 删掉那个只转发信号的 `route` 节点，三路改用 `args.task`（**level 1，零模型成本**）
- `coding_help` 的提问在 `scout` 之前就被答了（**没有仓库上下文**）
  → 监听器加 `after: handoff`
- `story_dnd` 的回合跑到 `seat` 之前就开打了（**开场白还没说**）
  → 回合池加 `after: seat`
- `safeEval` 收的是表达式字符串不是 AST，传 AST 进去静默返回 fail（池永远不触发）
- 剪贴板回读乱码 —— `SHELL_TASKS` 少了 PowerShell 的 UTF-8 输出前导
- 校验器 `asArray` 在模块顶层尚未初始化（TDZ）

### 数字

```
真人模拟    133 项（六张 example × 五种模型性格 + 环控区边界）
执行器      116 · 校验器 59 · 加载器 39 · 求值器 51 · 作业端到端 19
──────────────────────────────────────────────
合计        398 项断言 + 两个 fuzz 套件 + 一致性审计
```
