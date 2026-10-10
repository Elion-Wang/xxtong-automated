// 标定档的读取、缩放、坐标换算，以及「答案 → 动作批次」的编排。
//
// 这一层刻意做成纯函数 + 极少量只读文件访问，方便 node --test 直接测：
//   - 截图坐标 <-> 屏幕物理坐标
//   - 换分辨率时按比例派生标定档
//   - 答题卡格子定位、选项点定位
//   - 动作批次编排（每批 <= maxActionsPerBatch）
//
// 这里不 import 任何 cordis / dsh 的东西，所以可以脱离宿主单独跑。

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 包根目录（src/host/ 往上两级）
export const PACKAGE_ROOT = resolve(HERE, '..', '..');
// 包内自带的标定档目录
export const BUILTIN_PROFILE_DIR = join(PACKAGE_ROOT, 'profiles');
// 用户自己的标定档放在 $DSH_HOME 下的这个名字里
export const USER_PROFILE_DIR_NAME = 'xxtong-automated';

// 允许的标定档 id：字母数字点横下划线，且不能以点开头（防止路径穿越）
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertProfileId(id) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) {
    throw new Error(
      '标定档 id 不合法：' + String(id) + '（只允许字母数字 . _ -，且不能以点开头）',
    );
  }
  return id;
}

export function userProfileDir(dshHome) {
  const home = dshHome || process.env.DSH_HOME || process.cwd();
  return join(home, USER_PROFILE_DIR_NAME, 'profiles');
}

export async function readJson(file) {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text);
}

async function listJsonFiles(dir) {
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.json')).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

// 列出所有可用标定档：包内自带的 + 用户自己存的
export async function listProfiles(dshHome) {
  const out = [];
  for (const file of await listJsonFiles(BUILTIN_PROFILE_DIR)) {
    try {
      const p = await readJson(file);
      out.push({
        id: p.id || file,
        label: p.label || '',
        source: 'builtin',
        path: file,
      });
    } catch {
      // 坏文件跳过，不影响其它档
    }
  }
  for (const file of await listJsonFiles(userProfileDir(dshHome))) {
    try {
      const p = await readJson(file);
      out.push({
        id: p.id || file,
        label: p.label || '',
        source: 'user',
        path: file,
      });
    } catch {
      // 同上
    }
  }
  return out;
}

// 读一份标定档：先找用户目录（同名优先），再找包内自带
export async function loadProfile({ profileId, dshHome }) {
  const id = assertProfileId(profileId);
  const candidates = [
    { file: join(userProfileDir(dshHome), id + '.json'), source: 'user' },
    { file: join(BUILTIN_PROFILE_DIR, id + '.json'), source: 'builtin' },
  ];
  for (const c of candidates) {
    try {
      const profile = await readJson(c.file);
      return { ...profile, id, source: c.source, path: c.file };
    } catch {
      // 试下一个
    }
  }
  throw new Error('找不到标定档 ' + id + '（可用 xxtong_profile action=list 查看）');
}

// 把派生/编辑出来的标定档存到用户目录（不会写进包内自带目录）
export async function saveProfile(profile, { dshHome, id }) {
  const pid = assertProfileId(id || profile.id);
  const dir = userProfileDir(dshHome);
  await mkdir(dir, { recursive: true });
  const file = join(dir, pid + '.json');
  const payload = { ...profile, id: pid };
  await writeFile(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { file, id: pid };
}

// ---------------------------------------------------------------- 坐标换算

// 截图坐标 -> 屏幕物理坐标
export function toPhysical(profile, point) {
  const s = profile.screen || {};
  const sx = (s.physicalWidth || 0) / (s.captureWidth || 1);
  const sy = (s.physicalHeight || 0) / (s.captureHeight || 1);
  return [round(point[0] * sx), round(point[1] * sy)];
}

// 屏幕物理坐标 -> 截图坐标
export function toImage(profile, point) {
  const s = profile.screen || {};
  const sx = (s.physicalWidth || 0) / (s.captureWidth || 1);
  const sy = (s.physicalHeight || 0) / (s.captureHeight || 1);
  return [round(point[0] / sx), round(point[1] / sy)];
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// 把一份标定档按「新的屏幕物理分辨率」整体等比缩放，得到新档。
// 只缩放坐标，不动 captureWidth/Height（那取决于 computer_act 的截图上限）。
export function scaleProfile(base, target = {}) {
  const src = base.screen || {};
  const physicalWidth = Number(target.physicalWidth) || src.physicalWidth;
  const physicalHeight = Number(target.physicalHeight) || src.physicalHeight;
  const kx = physicalWidth / (src.physicalWidth || physicalWidth);
  const ky = physicalHeight / (src.physicalHeight || physicalHeight);

  const px = (p) => [round(p[0] * kx), round(p[1] * ky)];
  const scaled = JSON.parse(JSON.stringify(base));

  scaled.screen = {
    ...src,
    physicalWidth,
    physicalHeight,
    captureWidth: Number(target.captureWidth) || src.captureWidth,
    captureHeight: Number(target.captureHeight) || src.captureHeight,
  };

  if (scaled.content) {
    scaled.content.optionX = round(scaled.content.optionX * kx);
    if (scaled.content.optionY) {
      for (const k of Object.keys(scaled.content.optionY)) {
        scaled.content.optionY[k] = round(scaled.content.optionY[k] * ky);
      }
    }
    if (Array.isArray(scaled.content.optionRowYs)) {
      scaled.content.optionRowYs = scaled.content.optionRowYs.map((y) =>
        round(y * ky),
      );
    }
    if (typeof scaled.content.stemY === 'number') {
      scaled.content.stemY = round(scaled.content.stemY * ky);
    }
  }

  if (scaled.nav) {
    for (const [group, grid] of Object.entries(scaled.nav)) {
      if (!grid || typeof grid !== 'object' || !grid.cols) continue;
      grid.cols = grid.cols.map((x) => round(x * kx));
      grid.rows = (grid.rows || []).map((y) => round(y * ky));
    }
  }

  if (scaled.buttons) {
    for (const key of ['saveDraft', 'submit']) {
      if (Array.isArray(scaled.buttons[key])) {
        scaled.buttons[key] = px(scaled.buttons[key]);
      }
    }
  }

  if (scaled.editor) {
    if (typeof scaled.editor.clickX === 'number') {
      scaled.editor.clickX = round(scaled.editor.clickX * kx);
    }
    if (Array.isArray(scaled.editor.clickYByNavIndex)) {
      scaled.editor.clickYByNavIndex = scaled.editor.clickYByNavIndex.map((y) =>
        round(y * ky),
      );
    }
    if (typeof scaled.editor.fallbackClickY === 'number') {
      scaled.editor.fallbackClickY = round(scaled.editor.fallbackClickY * ky);
    }
  }

  if (scaled.scroll) {
    if (typeof scaled.scroll.pointX === 'number') {
      scaled.scroll.pointX = round(scaled.scroll.pointX * kx);
    }
    if (typeof scaled.scroll.pointY === 'number') {
      scaled.scroll.pointY = round(scaled.scroll.pointY * ky);
    }
    if (typeof scaled.scroll.pixelsPerNotch === 'number') {
      scaled.scroll.pixelsPerNotch = round(scaled.scroll.pixelsPerNotch * ky);
    }
  }

  scaled.derivedFrom = base.id || null;
  scaled.derivedScale = { kx: round(kx), ky: round(ky) };
  return scaled;
}

// ---------------------------------------------------------------- 定位

// 第 n 题属于哪一段（判断/简答/单选），以及它在答题卡里的 0 基下标
export function sectionForNumber(profile, n) {
  const sections = Array.isArray(profile.sections) ? profile.sections : [];
  for (const s of sections) {
    if (n >= s.from && n <= s.to) {
      return { group: s.group, title: s.title, index: n - s.from };
    }
  }
  return null;
}

// 答题卡某个格子的屏幕物理坐标。index 是 0 基。
// 返回 null 表示这个格子不在当前可视范围内（需要先滚动，或窗口没放到足够高）。
export function navCell(profile, group, index) {
  const grid = profile.nav && profile.nav[group];
  if (!grid || !Array.isArray(grid.cols) || !grid.cols.length) return null;
  const cols = grid.cols.length;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const rows = grid.rows || [];
  if (row >= rows.length) return null;
  return [grid.cols[col], rows[row]];
}

// 选项 A/B/C/D 的点击点
export function optionPoint(profile, letter) {
  const content = profile.content || {};
  const key = String(letter || '').trim().toUpperCase();
  const y = content.optionY && content.optionY[key];
  if (typeof y !== 'number') {
    throw new Error('标定档里没有选项 ' + key + ' 的纵坐标');
  }
  return [content.optionX, y];
}

// ---------------------------------------------------------------- 动作编排

const LETTERS = ['A', 'B', 'C', 'D'];

// 生成「点一下某个物理点」的动作。
// 注意：computer_act 的 click 动作只吃选择器、会忽略 x/y，而学习通是
// Electron 应用、UIA 树里没有任何控件；所以这里统一用 drag 的同点按下抬起
// 来当点击（Chromium 收到 down→up 会派发 click）。
export function clickAction(point, expectNote) {
  return {
    type: 'drag',
    fromPoint: [point[0], point[1]],
    toPoint: [point[0], point[1]],
    durationMs: 120,
    allowUnverified: true,
    note: expectNote,
  };
}

export function waitAction(ms) {
  return { type: 'wait', waitMs: ms };
}

export function screenshotAction(note) {
  return { type: 'screenshot', note };
}

export function scrollAction(profile, direction, count) {
  const s = profile.scroll || {};
  return {
    type: 'scroll',
    direction,
    count,
    point: [s.pointX ?? 1100, s.pointY ?? 500],
    allowUnverified: true,
  };
}

export function keyAction(key) {
  return { type: 'key', key, allowUnverified: true };
}

export function hotkeyAction(keys) {
  return { type: 'hotkey', keys, allowUnverified: true };
}

// 富文本框的落点：优先用按题号标定的值，没有就用兜底值
export function editorPoint(profile, navIndex) {
  const e = profile.editor || {};
  const x = e.clickX ?? 1120;
  const byIndex = Array.isArray(e.clickYByNavIndex) ? e.clickYByNavIndex : [];
  const y =
    typeof byIndex[navIndex] === 'number'
      ? byIndex[navIndex]
      : (e.fallbackClickY ?? 528);
  return [x, y];
}

// 把一份答案翻译成若干个动作批次。answers 是数组，每项：
//   { n: 题号, kind: 'single' | 'multi' | 'text', option: 'A'|'B'|'C'|'D', lines: ['第一行', ...] }
// 返回 { batches, warnings }。绝不包含提交步骤，除非调用方显式允许。
export function buildPlan(profile, answers, options = {}) {
  const maxActions = options.maxActionsPerBatch ?? 25;
  const maxBatches = options.maxBatches ?? 40;
  const verify = options.verify !== false;
  const steps = Array.isArray(options.steps) ? options.steps : ['draft'];
  const allowSubmitStep = options.allowSubmitStep === true;
  const wantSubmit = steps.includes('submit');

  const warnings = [];
  const batches = [];
  let current = [];
  let currentTopics = [];
  let seq = 0;
  // 每个批次累计到 maxActions 就切一刀（批次之间不依赖），
  // 这样调用方可以「一批一次 computer_act」地下发。
  const flush = (why) => {
    if (!current.length) return;
    seq += 1;
    batches.push({
      index: seq,
      goal: '学习通作业：' + (currentTopics.join('、') || why || '动作批次'),
      actions: current,
      hint:
        '把 actions 原样作为一次 computer_act 的 actions 下发，' +
        'window 用标定档里的窗口标题（学习通）。做完先看返回的截图再继续。',
    });
    current = [];
    currentTopics = [];
  };
  const push = (action, topic) => {
    current.push(action);
    if (topic) currentTopics.push(topic);
    if (current.length >= maxActions) flush('达到单批动作上限');
  };

  for (const answer of Array.isArray(answers) ? answers : []) {
    const n = Number(answer && answer.n);
    if (!Number.isInteger(n) || n <= 0) {
      warnings.push('跳过一条没有合法题号的答案：' + JSON.stringify(answer));
      continue;
    }
    const section = sectionForNumber(profile, n);
    const topic = '第' + n + '题';

    if (section) {
      const cell = navCell(profile, section.group, section.index);
      if (cell) {
        push(clickAction(cell, '点答题卡跳到第' + n + '题'), topic);
        push(waitAction(700));
      } else {
        warnings.push(
          '第' +
            n +
            '题的答题卡格子不在标定范围内（可能要先把窗口放到足够高，或改滚轮方案），已跳过跳题步骤',
        );
      }
    } else {
      warnings.push('第' + n + '题不在标定档的 sections 里，无法自动跳题');
    }

    const kind = answer.kind || (Array.isArray(answer.lines) ? 'text' : 'single');

    if (kind === 'text') {
      const lines = Array.isArray(answer.lines) ? answer.lines.slice() : [];
      if (!lines.length) {
        warnings.push('第' + n + '题是简答题，但 lines 为空，已跳过');
        continue;
      }
      for (const line of lines) {
        if (typeof line !== 'string' || /[\r\n]/.test(line)) {
          warnings.push(
            '第' +
              n +
              '题的某一行里有换行符：type_text 不会把 \\n 变成换行，' +
              '请把每一行拆成 lines 数组里独立的一项',
          );
        }
      }
      const point = editorPoint(profile, section ? section.index : 0);
      push(clickAction(point, '点进第' + n + '题的答案框'), topic);
      push(waitAction(300));
      push(hotkeyAction(['ctrl', 'a'])); // 全选后直接输入，等于替换原有内容
      push(waitAction(150));
      lines.forEach((line, i) => {
        if (i > 0) push(keyAction('enter'));
        push({ type: 'type_text', text: line, mode: 'sendinput', allowUnverified: true }, topic);
      });
      push(waitAction(300));
      if (verify) push(screenshotAction('复核第' + n + '题输入内容'));
    } else {
      const letter = String(answer.option || '').trim().toUpperCase();
      if (!LETTERS.includes(letter)) {
        warnings.push('第' + n + '题的 option 不是 A/B/C/D，已跳过');
        continue;
      }
      const point = optionPoint(profile, letter);
      push(clickAction(point, '选第' + n + '题 ' + letter), topic);
      push(waitAction(400));
      if (verify) push(screenshotAction('复核第' + n + '题选中情况'));
    }
  }

  if (steps.includes('draft')) {
    const save = (profile.buttons && profile.buttons.saveDraft) || null;
    if (save) {
      push(clickAction(save, '点暂存保存草稿'), '暂存');
      push(waitAction(900));
      push(screenshotAction('确认保存成功的提示'));
    } else {
      warnings.push('标定档里没有 buttons.saveDraft，无法生成暂存步骤');
    }
  }

  if (wantSubmit) {
    if (!allowSubmitStep) {
      warnings.push(
        '请求里含 submit，但安全闸门 allowSubmitStep=false（cordis.patch.yml 里可改），已忽略提交步骤',
      );
    } else {
      const submit = (profile.buttons && profile.buttons.submit) || null;
      if (submit) {
        push(clickAction(submit, '点提交'), '提交');
        push(waitAction(1200));
        push(screenshotAction('确认提交结果'));
        warnings.push(
          '提交步骤已生成：确认用户明确要求提交后再下发，并处理可能的确认弹窗',
        );
      } else {
        warnings.push('标定档里没有 buttons.submit，无法生成提交步骤');
      }
    }
  }

  flush('收尾');

  if (batches.length > maxBatches) {
    warnings.push(
      '计划共 ' + batches.length + ' 批，超过 maxBatches=' + maxBatches + '，已截断',
    );
    batches.length = maxBatches;
  }

  return {
    batches,
    warnings,
    policy: {
      maxActionsPerBatch: maxActions,
      maxBatches,
      submitIncluded: wantSubmit && allowSubmitStep,
      note: '所有点击都用 drag 同点模拟；所有输入都用 sendinput；每批动作数不超过上限。',
    },
  };
}
