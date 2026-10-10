# 超星作业自动化完成 · dsh-xxtong-automated

> 把 **DeepSeek Harness 的 Windows 桌面操作能力**（结构化观察 + 坐标驱动 + 逐字符输入）
> 与 **preset-plus 预设**打包成一个 DSH 插件：装上以后，模型就能对着**学习通 PC 客户端**
> 读题、作答、逐题复核、暂存 —— 而**交卷永远由你自己点**。

- 插件包名：`dsh-xxtong-automated`
- 仓库名：`xxtong-automated`
- 许可：MIT

---

## 目录

- [它能做什么 / 不做什么](#它能做什么--不做什么)
- [前置条件](#前置条件)
- [安装（一键导入）](#安装一键导入)
- [快速开始](#快速开始)
- [插件用法详解](#插件用法详解)
  - [xxtong_profile](#1-xxtong_profile--标定档管理)
  - [xxtong_layout_check](#2-xxtong_layout_check--只读自检)
  - [xxtong_plan](#3-xxtong_plan--答案变动作批次)
  - [xxtong_preset](#4-xxtong_preset--preset-plus-预设)
  - [配套的 computer_observe / computer_act](#5-配套的-computer_observe--computer_act)
- [配置项](#配置项)
- [换分辨率：标定](#换分辨率标定)
- [安全与隐私](#安全与隐私)
- [目录结构](#目录结构)
- [开发](#开发)
- [致谢](#致谢)

---

## 它能做什么 / 不做什么

**能做**

- 把一份作业答案翻译成一批批可复核的桌面动作：点答题卡跳题 → 选选项 → 富文本框逐行输入 → 截图复核 → 暂存。
- 带一份**实测的坐标标定档**（2560x1600、窗口最大化），并支持按新分辨率派生。
- 带一份 preset-plus 预设，把「先观察再动手、每批 ≤25 个动作、只暂存不提交、注释写成 `# 内容`」固化成纪律。
- 一键导入：仓库根目录本身就是插件包，`dsh plugin add github:Elion-Wang/xxtong-automated` 即可。

**不做**

- **不自动提交**。配置里 `allowSubmitStep` 默认 `false`，工具不会生成提交步骤；交卷由人来做。
- 不替你想答案：它只把你给出的答案填进去（答案正确性由你负责）。
- 不联网、不上传截图/答案/日志；仓库里没有账号、cookie、密钥、机器路径。
- 不碰手机端学习通（那是 adb/模拟器的活儿）。

---

## 前置条件

| 需要 | 说明 |
| --- | --- |
| DeepSeek Harness（DSH） | 能装 third-party 插件的版本 |
| `dsh-computer-use-windows` | 提供 `computer_observe` / `computer_act`，**必须启用**；本插件只做规划，不动手 |
| preset-plus（可选） | 想用内置预设就装：`dsh plugin add github:Rain-kl/dsh-preset-plus` |
| 学习通 PC 客户端 | 已登录，停在一个作业的答题页 |
| 系统 | Windows（依赖 UIA + SendInput；本插件本身是纯 Node，无 Python 依赖） |

---

## 安装（一键导入）

### 方式 A：从 GitHub 一键导入（推荐）

```bash
# 默认 profile
dsh plugin add github:Elion-Wang/xxtong-automated

# 指定 profile（和 preset-plus 的 README 里一样，profile 名按你自己的来）
dsh plugin --profile web add github:Elion-Wang/xxtong-automated
```

包内已经带好 `cordis.patch.yml`，插进去就会自动注册：

- 4 个工具：`xxtong_profile` / `xxtong_plan` / `xxtong_preset` / `xxtong_layout_check`
- 1 个运行时技能：`xxtong-automated`（正文就是本仓库的 `SKILL.md`）
- 1 段系统提示（提醒先读技能再动手；不想用可以把 `registerPrompt` 关掉）

### 方式 B：从本地文件夹导入

```bash
git clone https://github.com/Elion-Wang/xxtong-automated.git
dsh plugin add <克隆下来的文件夹路径>
```

### 方式 C：当作普通 npm 包放进 profile

把整个文件夹放进 `$DSH_HOME/profiles/<profile>/node_modules/dsh-xxtong-automated/`，
并按 `package.json` 的 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 里那**一行** id，
在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里确认存在。

> ⚠️ 改配置要在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里用**同一个 id 重述整行**，
> 后写的 patch 会**整体替换**该行 config —— 想保留的键要全部写上。

### 装完自检

在会话里问一句「学习通自动化装好了吗」，或者直接：

```jsonc
xxtong_profile({ "action": "list" })
```

能看到 `example-2560x1600`（source=`builtin`）就说明工具已经注册成功。

---

## 快速开始

```jsonc
// 1) 看窗口（学习通是 Electron，marks 会是空的，这是正常的）
computer_observe({ "window": "学习通", "detail": "tree" })

// 2) 最大化，让整页（含答题卡第二排 19-23）都可见
computer_act({
  "window": "学习通",
  "actions": [
    { "type": "focus" },
    { "type": "hotkey", "keys": ["win", "up"], "allowUnverified": true },
    { "type": "wait", "waitMs": 600 },
    { "type": "screenshot" }
  ]
})

// 3) 取标定档（window.title 就是下面要传给 computer_act 的窗口选择器）
xxtong_profile({ "action": "get" })

// 4) 读题（截图 + 滚轮）
computer_observe({ "window": "学习通", "includeScreenshot": true, "screenshotMaxEdge": 2560 })
computer_act({ "window": "学习通",
  "actions": [{ "type": "scroll", "direction": "down", "count": 5, "point": [1100, 500], "allowUnverified": true }] })

// 5) 把你整理好的答案交给插件，让它切批
xxtong_plan({
  "answers": [
    { "n": 1, "option": "A" },
    { "n": 3, "option": "B" },
    { "n": 12, "kind": "text", "lines": ["import math", "print(round(math.pi, 4))"] }
  ],
  "steps": ["draft"]
})

// 6) 一批一次下发（batches 已经按 ≤25 个动作切好）
computer_act({ "window": "学习通", "goal": "<batch.goal>", "actions": <batch.actions> })

// 7) 看截图复核；最后一批会点「暂存」并截图确认
```

---

## 插件用法详解

### 1. `xxtong_profile` —— 标定档管理

坐标全都来自标定档，**不猜**。

| action | 参数 | 返回 |
| --- | --- | --- |
| `get` | `profileId?` | 当前档的窗口信息、屏幕尺寸、分段、选项点、按钮点、编辑器落点、滚轮参数 |
| `list` | — | 所有可用档（`builtin` = 包内自带，`user` = 你存在 `$DSH_HOME` 下的） |
| `derive` | `target: { physicalWidth, physicalHeight, captureWidth?, captureHeight? }` | 按新分辨率等比缩放出来的档 |
| `save` | `saveAs`, `profile` | 把档存到 `$DSH_HOME/xxtong-automated/profiles/<id>.json` |
| `convert` | `point: [x,y]`, `from: "image"｜"physical"` | 截图坐标 ↔ 屏幕物理坐标换算，带 scale |

```jsonc
// 例：截图坐标 (1000,500) 在物理屏上落在哪
xxtong_profile({ "action": "convert", "point": [1000, 500], "from": "image" })
// => { "ok": true, "image": [1000,500], "physical": [1600,800], "scale": { "x": 1.6, "y": 1.6 } }
```

要点：

- 换算关系是 `物理 = 截图 × (屏幕物理尺寸 / 截图尺寸)`，**横纵要分别算**（截图长边常被限制到 1600）。
- `save` 只会写到 `$DSH_HOME` 下，**不会污染插件包目录**。
- 标定档 id 只允许 `字母数字 . _ -`，且不能以点开头（防止路径穿越）。

### 2. `xxtong_layout_check` —— 只读自检

换机器后第一步用它，**不改任何状态、不驱动界面**：

```jsonc
// 看某一题的落点
xxtong_layout_check({ "question": 23 })
// => { "navPoint": [2178, 854], "optionPoints": { "A": [560,339], "B": [560,416], "C": [560,493], "D": [560,570] } }

// 看整份布局
xxtong_layout_check({})
```

`navPoint` 为 `null` 说明那个格子不在当前可视范围（窗口不够高，或需要滚动）。

### 3. `xxtong_plan` —— 答案变动作批次

**这是主力工具**：输入一份答案，输出可以直接喂给 `computer_act` 的批次。

输入：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `answers` | 数组 | 每一项 `{ n, kind, option, lines }` |
| `answers[].n` | 整数 | 题号（页面上的真实题号） |
| `answers[].kind` | `single` \| `multi` \| `text` | 不填时：有 `lines` 就算 `text`，否则 `single` |
| `answers[].option` | `A`/`B`/`C`/`D` | 判断题 `A=对`、`B=错` |
| `answers[].lines` | 字符串数组 | 简答题一行一个元素；**不要**在元素里放 `\n` |
| `steps` | 数组 | `["draft"]`（默认，点暂存）、`["draft","submit"]`（需配置允许） |
| `verify` | 布尔 | 每题之后插一次截图复核，默认 `true` |
| `maxActionsPerBatch` | 整数 | 覆盖配置，默认 25（上限也是 25） |
| `profileId` / `profile` | — | 指定标定档，或用一份临时档 |

输出：

```jsonc
{
  "ok": true,
  "window": "学习通",
  "batches": [ { "index": 1, "goal": "学习通作业：第1题、第3题", "actions": [ … ], "hint": "…" } ],
  "warnings": [ "第19题的答题卡格子不在标定范围内…" ],
  "policy": { "maxActionsPerBatch": 25, "maxBatches": 40, "submitIncluded": false },
  "usage": "对每个 batch：调用一次 computer_act({ window, actions, goal })…"
}
```

动作是怎么翻译的（出问题时你可以手写替代）：

| 意图 | 动作 |
| --- | --- |
| 跳题 | `{ "type": "drag", "fromPoint": [答题卡格子], "toPoint": [同点] }` |
| 选选项 | 同上，点是 `content.optionX` × `optionY[字母]` |
| 点进答题框 | 同上，点是 `editor.clickX` × `editor.clickYByNavIndex[段内下标]` |
| 清空原内容 | `{ "type": "hotkey", "keys": ["ctrl","a"] }` |
| 逐行输入 | `{ "type": "type_text", "text": "…", "mode": "sendinput" }`，行间 `{ "type": "key", "key": "enter" }` |
| 复核 | `{ "type": "screenshot" }` |
| 暂存 | `{ "type": "drag", … }` 点在 `buttons.saveDraft` |

为什么点击一律用 `drag` 同点：`computer_act` 的 `click` 只接受选择器、**会忽略 x/y**，
而学习通没有可用的 UIA 控件；`drag` 的同点按下抬起，Chromium 会照常派发一次 click。

### 4. `xxtong_preset` —— preset-plus 预设

| action | 参数 | 行为 |
| --- | --- | --- |
| `status` | — | 看 `$DSH_HOME/preset-plus.json` 里有没有本预设、当前激活的是哪条 |
| `export` | `target?` | 返回预设本体；给了路径就顺便写一份文件 |
| `install` | `confirm: true` | 合并进 `preset-plus.json`，**先备份**为 `preset-plus.json.bak-<时间戳>` |

```jsonc
xxtong_preset({ "action": "status" })
xxtong_preset({ "action": "install", "confirm": true })   // 不传 confirm 会被拒绝
```

- 只往 `presets` 里加/换 `xxtong-automated` 一条，**不动你的其它预设**。
- **不会替你改 `activePresetId`**：装完请到 DSH 的 preset-plus 面板里激活它。
- 也可以用命令行：`node scripts/install-preset.mjs [--dry-run] [--dsh-home <dir>]`。

预设内容（两条 system 条目）：

1. 桌面自动化的纪律：先观察、分批、只暂存、不确定就问；
2. 作答规范：代码带中文注释、注释写成 `# 内容`、不要 `# 1）…` 编号前缀、判断题 `A=对`。

### 5. 配套的 `computer_observe` / `computer_act`

本插件不自己驱动界面，动作都交给 `computer-use-windows`。几条必须记住的：

- `computer_observe` 的 `window` 是**标题子串/正则**；DSH 自己的窗口标题也可能含「学习通」，
  所以拿到 hwnd 后优先用 hwnd。
- `computer_observe({ includeScreenshot: true })` 截的是**目标窗口**（PrintWindow，原生分辨率）；
  `computer_act` 里的 `screenshot` 动作截的是**整屏**。前者读题、后者算坐标，别混。
- 每个改变状态的动作要么带 `expect`，要么显式 `allowUnverified: true`——学习通没有控件，
  本项目一律用 `allowUnverified` + **动作后截图复核**，这一点在回答用户时要说明白。
- 窗口被最小化时会报
  `window … is occluded over the point(s) this action would touch and could not be raised to the foreground`，
  并且窗口截图全黑。**这时请用户恢复窗口**，不要硬试。

---

## 配置项

`cordis.patch.yml`（或你在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里重述的那一行）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关掉后工具仍在，但 `xxtong_plan` 直接返回 `disabled` |
| `profileId` | `example-2560x1600` | 用哪份标定档 |
| `maxActionsPerBatch` | `25` | 单批动作上限，会被夹到 `1..25` |
| `maxBatches` | `40` | 一次计划最多几批，夹到 `1..200` |
| `allowSubmitStep` | `false` | `true` 才允许生成提交步骤（提交前仍需用户同意） |
| `registerSkill` | `true` | 注册运行时技能（读 `SKILL.md`） |
| `registerPrompt` | `true` | 注入一段系统提示 |

---

## 换分辨率：标定

```bash
# 1) 派生
xxtong_profile({ "action": "derive", "target": { "physicalWidth": 2560, "physicalHeight": 1440 } })
# 2) 存档
xxtong_profile({ "action": "save", "saveAs": "local-2560x1440", "profile": <profile> })
# 3) 把 cordis.patch.yml 的 profileId 改成 local-2560x1440
```

细节（含一张网格图的生成方式、字段速查、常见坑）见 [`docs/CALIBRATION.md`](docs/CALIBRATION.md)。

---

## 安全与隐私

- **只暂存，不提交。** `allowSubmitStep` 默认关；提交是不可逆动作，只由人发起。
- **不联网。** 插件不做任何网络请求；截图与答案都留在本机。
- **仓库里没有隐私数据。** 不含账号、cookie、token、运行日志、机器路径；
  `.gitignore` 已经把 `evidence/`、`*.log`、`profiles/local-*.json` 排除在外。
- **标定档只是坐标。** 里面的数字是「这套界面在某个分辨率下的位置」，不包含任何题目或答案内容。
- **随时可停。** 用户叫停时已写进答题框的内容不会被清除；暂存过的草稿在服务器上。

> 使用须知：工具只自动化**你自己提供的答案**的录入过程，不做题、不判断、不交卷。
> 请遵守你所在学校关于作业与考试的规定，风险自负。

---

## 目录结构

```text
xxtong-automated/
├── package.json              # DSH 插件清单（main / exports / dsh.bundle.patch）
├── cordis.patch.yml          # 插件装配那一行（id/name/config）
├── lib/index.js              # 打包入口（转发到 src/host）
├── src/host/
│   ├── index.js              # apply(ctx, config)：注册工具、技能、系统提示
│   ├── config.js             # 配置默认值与夹紧
│   ├── layout.js             # 坐标换算 / 标定档缩放 / 动作批次编排（纯函数）
│   ├── tools.js              # 四个工具的注册与 execute
│   └── preset.js             # preset-plus 预设的读取/导出/合并安装
├── profiles/
│   └── example-2560x1600.json  # 实测参考标定档
├── presets/
│   └── xxtong-automated.json   # 内置 preset-plus 预设
├── scripts/
│   ├── install-preset.mjs    # 命令行安装预设
│   └── calibrate.ps1         # 截图叠物理坐标网格，辅助标定
├── docs/
│   ├── CALIBRATION.md        # 标定指南
│   ├── WORKFLOW.md           # 从零到暂存的完整流程
│   └── FAQ.md                # 常见问题
├── test/
│   ├── layout.test.mjs       # 纯逻辑单测
│   └── tools.test.mjs        # 工具层冒烟测试（假 ctx）
├── SKILL.md                  # 运行时技能（操作手册）
└── README.md
```

---

## 开发

```bash
npm test         # node --test：19 个用例（坐标换算、批次编排、提交闸门、preset 安装…）
npm run check    # node --check 全部源码 + 脚本
npm run setup:dry   # 打印预设会不会被写入，不落盘
npm run setup       # 真正把预设并入 $DSH_HOME/preset-plus.json（会备份）
```

设计上刻意保持**纯函数 + 极少量只读文件访问**：`layout.js` 不 import 任何宿主 API，
所以能在没有 DSH 的环境里直接跑测试；`tools.js` 只依赖一个 `ctx.tools.register`，
用一个假 ctx 就能把四个工具全测一遍。

---

## 致谢

- 本插件配合 **[`@rain-kl/dsh-preset-plus`](https://github.com/Rain-kl/dsh-preset-plus)** 使用，
  预设的存储格式、内置预设目录与导入方式都沿用该插件的约定。
  感谢原作者 **Rain-kl**：<https://github.com/Rain-kl>
- 桌面驱动依赖 DSH 的 `computer-use-windows` 插件（Windows UIA + SendInput）。
- 感谢 DeepSeek Harness 提供插件与技能扩展机制。

## License

[MIT](LICENSE)
