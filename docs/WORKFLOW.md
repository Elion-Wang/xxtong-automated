# 完整工作流

这一份是「从零到暂存」的逐步记录，包含实际会发出的工具调用。
把这个仓库的插件装上以后，照着做一遍就能把一份作业做完。

> 前提：`computer-use-windows` 插件已启用，学习通 PC 客户端已登录并停在一个作业的答题页上。

## 步骤 0 · 观察

```jsonc
computer_observe({ "window": "学习通", "detail": "tree" })
```

- 期望看到：`title: "学习通"`，`class: "Chrome_WidgetWin_1"`，`marks: []`（没有可点控件）。
- 报「找不到窗口」→ 让用户打开/恢复学习通；别硬试坐标。

## 步骤 1 · 最大化并确认前台

```jsonc
computer_act({
  "window": "学习通",
  "actions": [
    { "type": "focus" },
    { "type": "hotkey", "keys": ["win", "up"], "allowUnverified": true },
    { "type": "wait", "waitMs": 500 },
    { "type": "screenshot" }
  ]
})
```

看返回的截图：整页可见、右侧答题卡第二排（单选 19-23）也露出来了，就算准备好了。

## 步骤 2 · 取标定档

```jsonc
xxtong_profile({ "action": "get" })
```

返回里 `window.title` 就是第 3 步要传给 `computer_act` 的窗口选择器。换机器先看
[`CALIBRATION.md`](./CALIBRATION.md)。

## 步骤 3 · 读题

```jsonc
computer_observe({ "window": "学习通", "includeScreenshot": true, "screenshotMaxEdge": 2560 })
```

题目字号小时，把截图裁出来放大再看；一屏读不完就用滚轮推进：

```jsonc
computer_act({
  "window": "学习通",
  "actions": [{ "type": "scroll", "direction": "down", "count": 5, "point": [1100, 500], "allowUnverified": true }]
})
```

读出来的每一题都记成 `{ n, kind, option | lines }`，例如：

```json
[
  { "n": 1,  "kind": "single", "option": "A" },
  { "n": 3,  "kind": "single", "option": "B" },
  { "n": 12, "kind": "text", "lines": ["import math", "for x in [0, math.pi/4, math.pi/2, math.pi]:", "    print(x, math.sin(x), math.cos(x), math.tan(x))", "print(round(math.pi, 4))", "print(round(math.e, 3))"] }
]
```

约定：

- 判断题 `A = 对`、`B = 错`；
- 简答题 `lines` 一行一个元素，**不要**在字符串里塞 `\n`（计划会替你插回车）；
- 代码答案带中文注释，注释写成 `# 内容`，不要 `# 1）…` 这种编号前缀。

## 步骤 4 · 生成计划

```jsonc
xxtong_plan({ "answers": [ /* 上面那份数组 */ ], "steps": ["draft"], "verify": true })
```

返回：

```jsonc
{
  "ok": true,
  "window": "学习通",
  "batches": [
    {
      "index": 1,
      "goal": "学习通作业：第1题、第3题",
      "actions": [ /* drag / wait / screenshot ... */ ],
      "hint": "把 actions 原样作为一次 computer_act 的 actions 下发…"
    }
  ],
  "warnings": [],
  "policy": { "maxActionsPerBatch": 25, "submitIncluded": false }
}
```

- `batches` 已经按「每批 ≤ 25 个动作」切好，直接一批一次下发。
- `warnings` 里出现「需要先滚动」「不在标定范围」「含换行符」时先处理掉再执行。
- `policy.submitIncluded` 默认是 `false`；配置里打开 `allowSubmitStep` 且调用时传了
  `steps: ["draft","submit"]` 才会生成提交步骤，而**提交前仍然要用户明确同意**。

## 步骤 5 · 分批执行

```jsonc
computer_act({ "window": "学习通", "goal": "学习通作业：第1题、第3题", "actions": [ /* batch.actions */ ] })
```

每批做完看返回的截图复核：

- 选项被选中 → 圆圈变成实心蓝色；
- 富文本框有内容 → 逐行核对（注意：平台对以 `#` 开头的行处理不稳定，保存后要回读一次）；
- 答题卡上已答的题号样式会变化。

**不通过就停下来看图**：判断是坐标漂了、页面滚了，还是窗口不在前台，然后再下发修正动作，
不要原样重试同一批。

## 步骤 6 · 暂存

计划里最后一批已经包含「点暂存 + 等 1 秒 + 截图」。确认截图里出现
`保存成功！完成后请及时提交作业！` 就说明草稿已经存到服务器。

## 步骤 7 · 收尾（人工）

- 需要交卷时由**用户自己**点「提交」（或用户明确授权后再下发提交批次）。
- 提交按钮就在暂存右边约 154px 处，任何情况下点之前都先截图确认。

---

## 失败恢复手册

| 报错 / 现象 | 含义 | 处置 |
| --- | --- | --- |
| `too-many-actions` | 一批超过 25 个动作，整批被拒、无副作用 | 调小 `maxActionsPerBatch` 重新生成计划 |
| `window ... is occluded ...` | 目标窗口被挡/最小化，且提不到前台 | 请用户把窗口恢复并放到前台，再重发这一批 |
| `(empty selector) matches N nodes` | 用了不带选择器的 click | 点击一律用 `drag` 同点；`expect` 必须带选择器 |
| 点完没变化 | 窗口不在前台、坐标漂了、页面滚了 | 先 `focus` + 截图定位，再补一批 |
| 输入框没内容 | 粘贴被禁用 | 改用 `type_text` 的 `sendinput` 模式 |
| 保存后注释行少了 | 平台对 `#` 开头的行处理不稳 | 保存后回读；把重要解释改成不被吞的写法 |

## 与 preset-plus 配合

```jsonc
// 看状态
xxtong_preset({ "action": "status" })
// 安装（会先备份 preset-plus.json）
xxtong_preset({ "action": "install", "confirm": true })
```

装完在 DSH 的 preset-plus 面板里激活「超星作业自动化」那条预设；它会一直提醒模型
「先观察、分批下发、只暂存、注释写成 `# 内容`」。
