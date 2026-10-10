---
name: xxtong-automated
description: 超星学习通 PC 客户端作业自动化：观察窗口→读题→选答案/填简答→逐题截图复核→暂存。含坐标标定、分批动作、常见故障处理与安全纪律。
---

# 超星作业自动化（学习通 PC 客户端）

这个技能解决一件事：**用 DSH 的 computer-use 能力，在「学习通 PC 客户端」里把一份作业做完并暂存**，
过程中每一步都能复核、能被用户随时叫停，不触碰「自动提交」。

配套工具（由 `dsh-xxtong-automated` 插件注册）：

| 工具 | 作用 |
| --- | --- |
| `xxtong_profile` | 取/派生/保存坐标标定档；在截图坐标与屏幕物理坐标之间换算 |
| `xxtong_layout_check` | 只读自检：打印答题卡格子、选项点、按钮的坐标 |
| `xxtong_plan` | 把答案列表翻译成一批批 `computer_act` 动作 |
| `xxtong_preset` | 查看/导出/安装配合 preset-plus 的预设 |

真正驱动界面的是 `computer-use-windows` 插件的 `computer_observe` / `computer_act`。
本技能假定这两个工具可用；没有就先让用户装好并启动 computer-use。

---

## 0. 开工前的三条硬规则

1. **先观察再动手。** 每一轮都以 `computer_observe`（或一张截图）开始，坐标只从标定档取，
   不靠猜。同一窗口的 UIA 树在缓存期内可以直接复用。
2. **一批一次下发。** 一条确定的路线（跳题 → 选答案 → 截图）写成**一次** `computer_act`，
   默认每批不超过 **25** 个动作——超了会整批被拒（`too-many-actions`），且没有任何副作用。
3. **只暂存，不提交。** 提交是不可逆的高风险动作：必须由用户明确说「提交」之后才做。
   插件默认 `allowSubmitStep: false`，`xxtong_plan` 也不会生成提交步骤。

---

## 1. 把目标窗口准备好

```text
computer_observe({ window: "学习通", detail: "tree" })
```

要点：

- 学习通 PC 客户端是 Electron 应用（`Chrome_WidgetWin_1`）。**UIA 树里只有 Window + 几个
  `Chrome Legacy Window` 面板，`marks` 是空的**——没有任何可点控件。所以定位只能靠截图 +
  标定档坐标，别浪费时间在控件选择器上。
- 如果报 `找不到窗口`：学习通可能没开，或者被最小化了。窗口被最小化时 `computer_act` 会拒绝动作：
  `... is occluded over the point(s) ... could not be raised to the foreground`，
  而且 `PrintWindow` 截出来是全黑图。**这时候不要硬试**，请用户点任务栏的学习通图标恢复窗口。
- 把窗口最大化（`hotkey win+up`），这样整页都可见、答题卡第二排（单选 19-23）才会露出来。

> 窗口标题里带「学习通」三个字时要注意：`window` 参数是标题子串匹配，DSH 自己的窗口标题
> 也可能包含这几个字。观察一次拿到 hwnd 之后，后续动作直接用 hwnd 最稳。

---

## 2. 读题

读题有三条路，按顺序试：

1. **窗口截图 + 读图**（最常用）
   ```text
   computer_observe({ window: "学习通", includeScreenshot: true, screenshotMaxEdge: 2560 })
   ```
   得到窗口原生分辨率（例如 2560x960）的截图，再用图像能力读出题干。
2. **裁剪放大**：题干字号小的时候，把截图裁出来放大 1.5–2 倍再看，中文识别准确率明显更高。
3. **滚轮推进**：`computer_act` 里用 `{ type: "scroll", direction: "down", count: 5, point: [1100,500] }`
   一屏一屏往下读。标定档里的 `scroll.pixelsPerNotch` 记着「滚轮一档≈多少像素」，用来估算会不会漏题。

**不要指望复制粘贴取题**：学习通作业页里 `Ctrl+A` / `Ctrl+C` 拿不到内容（剪贴板不会变）。

---

## 3. 作答

### 3.1 客观题（判断 / 单选）

```text
xxtong_plan({ answers: [{ n: 1, option: "A" }, { n: 14, option: "B" }], steps: ["draft"] })
```

返回的每个 `batch.actions` 整批丢给一次 `computer_act`：

```text
computer_act({ window: "学习通", actions: batch.actions, goal: batch.goal })
```

计划里的动作翻译规则（记住这三条，出问题时能自己手写）：

- **跳题**：点右侧答题卡上的题号（坐标来自 `profile.nav`）。
- **选答案**：点选项行左侧的圆圈（`profile.content.optionX` + `optionY[字母]`）。
- **点击的实现**：`computer_act` 的 `click` 只吃选择器、会忽略 `x/y`，而学习通没有控件；
  所以统一用 `drag` 的**同点按下抬起**当点击——Chromium 收到 down→up 会派发 click。

### 3.2 简答题（富文本框）

```text
xxtong_plan({ answers: [{ n: 11, kind: "text", lines: ["n = 2", "print(id(n), type(n))"] }], steps: ["draft"] })
```

- 落到答题框 → `Ctrl+A` → 逐行 `type_text`，行与行之间插一个 `key: "enter"`。
- `type_text` 用 `mode: "sendinput"`：中文也能逐字符输入。
- **`\n` 不会变成换行**，所以一行一个 `lines` 元素，换行交给 `enter` 键。
- 富文本框**不接受 `Ctrl+V` 粘贴**（粘贴进去还是空白），别用剪贴板方案。
- 编辑器位置会随滚动变化，`profile.editor.clickYByNavIndex` 记着按题号标定的落点；
  不确定就先截图确认落点，再输入。

### 3.3 答案规范

- 代码答案必须带中文注释，注释写成 `# 内容`；
- **不要** `# 1）…`、`# 2）…` 这类编号前缀；
- 简答题一行一个语句或一条注释。

---

## 4. 复核

- 每道题之后计划里会插一个 `screenshot` 动作。把几张截图拼成一张大图再看，省读图次数。
- 客观题的「选中」表现为选项圆圈被蓝色实心填充；右侧答题卡上已答的题号样式也会变化。
- 想程序化复核时，扫截图里选项圆圈那一列（x 范围按标定档换算）的蓝色像素即可判断哪一行被选中。
- 全对不上就**停手看图**，别重复同样的坐标——先判断是坐标漂了、页面滚动了，还是窗口不在前台。

---

## 5. 暂存

- 「暂存」在顶部栏右侧，标定档里是 `buttons.saveDraft`（实测参考档约 `[2320,149]`）。
- 点完等 1 秒再截图，应该能看到 `保存成功！完成后请及时提交作业！` 的提示。
- **提交按钮紧挨着暂存（约 154px 之差）**，点之前一定先截图确认位置。

---

## 6. 常见故障对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `too-many-actions` | 一个批次超过 25 个动作 | 拆成两批，或用 `xxtong_plan` 的 `maxActionsPerBatch` |
| `...(empty selector) matches N nodes` | 用了不带选择器的 click | 点击一律用 `drag` 同点；expect 必须带选择器 |
| `window ... is occluded ...` + 黑截图 | 学习通被最小化/挡住 | 请用户恢复窗口，不要硬试 |
| 编辑器里粘不进东西 | 富文本框禁了粘贴 | 改用 `type_text` + `enter` |
| 保存后某些注释行没了 | 平台对以 `#` 开头的行处理不稳 | 保存后回读一次；重要的解释改写成不被吞的形式 |
| 答题卡看不到 19-23 | 窗口不够高 | 最大化窗口，或改用滚轮滚动到该题 |
| 坐标全偏 | 换了分辨率/缩放/显示器 | 跑 `docs/CALIBRATION.md` 的标定流程重新派生档 |
| 点完没反应 | 窗口不在前台 | 先把窗口 focus/点到前台，再重发这一批 |

---

## 7. 换机器/换分辨率

```text
xxtong_profile({ action: "derive", target: { physicalWidth: 2560, physicalHeight: 1440 } })
xxtong_profile({ action: "save", saveAs: "local-2560x1440", profile: <上一步的 profile> })
```

然后把 `cordis.patch.yml` 里的 `profileId` 改成新档，并按 `docs/CALIBRATION.md`
逐步核对（先 `xxtong_layout_check` 看坐标，再拿一道题实测）。

---

## 8. 安全与隐私

- 全流程只在本机操作屏幕，不上传音频/截图/答案到任何服务。
- 插件仓库与本技能里**没有**账号、cookie、日志、密钥、机器路径。
- 用户随时可以叫停；停之前已经写进答题框的内容不会被清除，暂存过的草稿在服务器上。
- 提交是不可逆动作：**只由用户发起**。
