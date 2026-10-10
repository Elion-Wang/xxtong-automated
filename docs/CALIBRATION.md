# 坐标标定指南

学习通 PC 客户端是 Electron 应用，UIA 树里**没有可交互控件**，所以所有点击都只能靠屏幕坐标。
这份文档说明这套坐标是怎么来的、怎么在别的机器上重新标一遍。

## 1. 两个坐标系

| 说法 | 含义 | 谁在用 |
| --- | --- | --- |
| **截图坐标** | `computer_act` 返回的整屏截图里的像素位置（通常是 1600x1000） | 你肉眼读图时 |
| **物理坐标** | 屏幕物理像素（例如 2560x1600） | 插件发给 `computer_act` 的坐标 |

换算关系就一条：

```text
物理坐标 = 截图坐标 × (屏幕物理宽度 / 截图宽度)      # 横向
物理坐标 = 截图坐标 × (屏幕物理高度 / 截图高度)      # 纵向
```

`profiles/*.json` 里的 `screen` 段记着这两个尺寸，`xxtong_profile` 的 `convert` 动作可以帮你换算：

```jsonc
// xxtong_profile({ action: "convert", point: [1000, 500], from: "image" })
{ "ok": true, "image": [1000, 500], "physical": [1600, 800], "scale": { "x": 1.6, "y": 1.6 } }
```

> 横向和纵向的比例**不一定相等**。整屏截图的宽高比和屏幕宽高比不一致时（例如截图被长边限制到 1600），
> 两个方向的缩放就会不同，所以要分别算。

## 2. 一次性标定（新机器 / 新分辨率）

1. 打开学习通 PC 客户端，登录，进入任意一次作业的答题页。
2. **把窗口最大化**（`Win` + `↑`）。窗口不够高时，右侧答题卡第二排题目（单选 19-23）不会渲染出来，
   标出来的坐标会在别的机器上对不上。
3. 用 `computer_act` 截一张整屏图（动作 `{ "type": "screenshot" }`）。
4. 用附带的脚本给截图叠一层物理像素网格：

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\calibrate.ps1 `
     -Screenshot <你那张截图> -ScreenWidth 2560 -ScreenHeight 1600
   ```

   （`pwsh` 7 也可以；脚本只读截图、写一张网格图，不动系统设置。）
5. 打开网格图，读出各项的**物理坐标**：
   - 右侧答题卡每组数字按钮的中心 → `nav.judge.cols/rows`、`nav.short`、`nav.choice`
   - 某一题选项圆圈的中心（A/B/C/D 四行的纵坐标）→ `content.optionY`，横坐标 → `content.optionX`
   - 顶部栏「暂存」和「提交」按钮 → `buttons.saveDraft` / `buttons.submit`
   - 简答题富文本框的可编辑区中心 → `editor.clickX` / `editor.clickYByNavIndex`
6. 换算回**截图坐标**再和网格图对照一遍，确认没读错行。
7. 把数字填进 `profiles/example-2560x1600.json` 复制出来的一份里（或者用
   `xxtong_profile({ action: "save", saveAs: "local-…", profile })`），并把
   `cordis.patch.yml` 的 `profileId` 改成这份新档。
8. 用只读工具先自检：

   ```jsonc
   // xxtong_layout_check({ question: 14 })
   { "navPoint": [1902, 760], "optionPoints": { "A": [560, 339], ... } }
   ```

9. 拿一道题实测：跳题 → 选一个选项 → 截图确认。对得上再批量做。

## 3. 换分辨率：先派生，再微调

```jsonc
// 1) 按目标分辨率派生
xxtong_profile({ "action": "derive", "target": { "physicalWidth": 2560, "physicalHeight": 1440 } })

// 2) 存成本机档
xxtong_profile({ "action": "save", "saveAs": "local-2560x1440", "profile": <上一步的 profile> })
```

派生是**等比缩放**，能覆盖大部分情况；但如果目标机器上学习通的布局不是简单缩放
（窗口没有最大化、侧边栏宽度固定、字体缩放不同），仍然要按第 2 节重新读一遍关键坐标。

## 4. 容易踩的坑

| 坑 | 表现 | 对策 |
| --- | --- | --- |
| 系统 DPI 缩放不是 100% | 截图坐标和物理坐标的比例不是整数 | 永远用 `xxtong_profile convert` 算，别心算 |
| 多显示器 | 截图来自「虚拟屏」，坐标原点是主屏左上角 | 尽量把学习通放在主屏并最大化 |
| 窗口没最大化 | 答题卡第二排不渲染，纵坐标整体偏移 | 先最大化，再截图标定 |
| 页面滚过 | 所有内容的纵坐标整体位移 | 每次先用答题卡跳题把页面归位，再点选项 |
| 窗口没在前台 | 动作被拒：`is occluded ... could not be raised` | 先把窗口点到前台；被最小化时请用户恢复 |
| 只标了一台机器 | 换机器后全部点偏 | 每台机器一份 `local-*.json`，`profileId` 分开 |

## 5. 标定档字段速查

```jsonc
{
  "screen": { "captureWidth": 1600, "captureHeight": 1000,
              "physicalWidth": 2560, "physicalHeight": 1600 },
  "sections": [
    { "group": "judge",  "title": "判断题", "from": 1,  "to": 10 },
    { "group": "short",  "title": "简答题", "from": 11, "to": 13 },
    { "group": "choice", "title": "单选题", "from": 14, "to": 23 }
  ],
  "content": { "optionX": 560, "optionY": { "A": 339, "B": 416, "C": 493, "D": 570 }, "stemY": 256 },
  "nav": {
    "judge":  { "cols": [1902, 1971, 2040, 2109, 2178], "rows": [339, 424] },
    "short":  { "cols": [1902, 1971, 2040],              "rows": [594] },
    "choice": { "cols": [1902, 1971, 2040, 2109, 2178], "rows": [760, 854] }
  },
  "buttons": { "saveDraft": [2320, 149], "submit": [2474, 149] },
  "editor": { "clickX": 1120, "clickYByNavIndex": [528, 528, 1184], "fallbackClickY": 528 },
  "scroll": { "pointX": 1100, "pointY": 500, "delta": -120, "pixelsPerNotch": 124 }
}
```

- `sections`：题号分段。`from`/`to` 是页面上真实的题号，答题卡格子按 `题号 - from` 定位。
- `nav.<group>`：答题卡按「每行几个（cols）+ 每行纵坐标（rows）」描述；越界的格子返回 `null`，
  `xxtong_plan` 会据此给出「需要先滚动/先最大化」的警告，而不是瞎点。
- `content.optionY`：四个选项行的心纵坐标；每行间隔在同一套界面里是固定的（本档约 77px）。
- `editor.clickYByNavIndex`：简答题按「段内下标」标定的落点（第 11、12、13 题落点不同）。
