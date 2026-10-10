// 纯逻辑的单元测试：坐标换算、标定档缩放、答题卡定位、动作编排。
// 跑法：node --test test/   （或 npm test）

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildPlan,
  navCell,
  optionPoint,
  PACKAGE_ROOT,
  scaleProfile,
  sectionForNumber,
  toImage,
  toPhysical,
} from '../src/host/layout.js';
import { resolveConfig } from '../src/host/config.js';

const profile = JSON.parse(
  await readFile(join(PACKAGE_ROOT, 'profiles', 'example-2560x1600.json'), 'utf8'),
);

test('截图坐标与物理坐标能互相换算', () => {
  assert.deepEqual(toPhysical(profile, [1000, 500]), [1600, 800]);
  assert.deepEqual(toImage(profile, [1600, 800]), [1000, 500]);
  // 答题卡第 1 格的物理坐标换算回截图坐标应该在页面右半边
  const cell = navCell(profile, 'judge', 0);
  assert.deepEqual(cell, [1902, 339]);
  assert.deepEqual(toImage(profile, cell), [1188.75, 211.88]);
});

test('换分辨率时标定档按比例缩放', () => {
  const scaled = scaleProfile(profile, { physicalWidth: 2560, physicalHeight: 1440 });
  assert.equal(scaled.screen.physicalHeight, 1440);
  assert.equal(scaled.derivedFrom, 'example-2560x1600');
  // 横向不变
  assert.equal(scaled.content.optionX, 560);
  // 纵向按 1440/1600 = 0.9 缩放
  assert.equal(scaled.content.optionY.A, 305.1);
  assert.equal(scaled.buttons.saveDraft[1], 134.1);
  assert.equal(scaled.nav.judge.rows[1], 381.6);
  assert.equal(scaled.scroll.pixelsPerNotch, 111.6);
});

test('题号能落到正确的分段与答题卡格子', () => {
  assert.deepEqual(sectionForNumber(profile, 1), { group: 'judge', title: '判断题', index: 0 });
  assert.deepEqual(sectionForNumber(profile, 13), { group: 'short', title: '简答题', index: 2 });
  assert.deepEqual(sectionForNumber(profile, 23), { group: 'choice', title: '单选题', index: 9 });
  assert.equal(sectionForNumber(profile, 99), null);

  // 判断题两排：1-5 在第一排，6-10 在第二排
  assert.deepEqual(navCell(profile, 'judge', 0), [1902, 339]);
  assert.deepEqual(navCell(profile, 'judge', 4), [2178, 339]);
  assert.deepEqual(navCell(profile, 'judge', 5), [1902, 424]);
  // 简答题一排
  assert.deepEqual(navCell(profile, 'short', 2), [2040, 594]);
  // 单选题第二排 19-23
  assert.deepEqual(navCell(profile, 'choice', 5), [1902, 854]);
  assert.deepEqual(navCell(profile, 'choice', 9), [2178, 854]);
  // 超出标定范围返回 null（调用方据此改走滚轮方案）
  assert.equal(navCell(profile, 'choice', 10), null);
});

test('选项点来自标定档', () => {
  assert.deepEqual(optionPoint(profile, 'a'), [560, 339]);
  assert.deepEqual(optionPoint(profile, 'D'), [560, 570]);
  assert.throws(() => optionPoint(profile, 'E'));
});

test('客观题计划：跳题 + 选答案 + 截图，点击一律用 drag 同点', () => {
  const { batches, warnings } = buildPlan(
    profile,
    [{ n: 1, option: 'A' }, { n: 14, option: 'B' }],
    { steps: ['draft'], verify: true, maxActionsPerBatch: 25 },
  );
  assert.equal(warnings.length, 0);
  const actions = batches.flatMap((b) => b.actions);
  // 两次跳题 + 两次选项点击 + 一次暂存
  const drags = actions.filter((a) => a.type === 'drag');
  assert.equal(drags.length, 5);
  for (const d of drags) assert.deepEqual(d.fromPoint, d.toPoint);
  assert.ok(drags.some((d) => d.fromPoint[0] === 1902 && d.fromPoint[1] === 339));
  assert.ok(drags.some((d) => d.fromPoint[0] === 560 && d.fromPoint[1] === 416));
  // 收尾一定包含一次暂存，且没有提交
  const tail = batches.at(-1).actions.filter((a) => a.type === 'drag').at(-1);
  assert.deepEqual(tail.fromPoint, [2320, 149]);
  assert.equal(actions.some((a) => a.fromPoint && a.fromPoint[0] === 2474), false);
});

test('简答题计划：点入答题框 + 全选 + 逐行输入 + 行间回车', () => {
  const lines = ['import math', 'print(round(math.pi, 4))'];
  const { batches } = buildPlan(
    profile,
    [{ n: 12, kind: 'text', lines }],
    { steps: [], verify: false, maxActionsPerBatch: 25 },
  );
  const actions = batches.flatMap((b) => b.actions);
  const texts = actions.filter((a) => a.type === 'type_text');
  assert.deepEqual(
    texts.map((t) => t.text),
    lines,
  );
  assert.equal(texts.every((t) => t.mode === 'sendinput'), true);
  // 两行之间恰好一个回车
  assert.equal(actions.filter((a) => a.type === 'key' && a.key === 'enter').length, 1);
  // 输入的顺序：点答题卡跳题 → 点入答题框 → 全选 → 第一行 → 回车 → 第二行
  const order = actions.map((a) => a.type + (a.key ? ':' + a.key : ''));
  assert.deepEqual(order, [
    'drag',
    'wait',
    'drag',
    'wait',
    'hotkey',
    'wait',
    'type_text',
    'key:enter',
    'type_text',
    'wait',
  ]);
});

test('超长计划按单批动作上限切分', () => {
  const answers = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, option: 'A' }));
  const { batches } = buildPlan(profile, answers, {
    steps: [],
    verify: true,
    maxActionsPerBatch: 5,
  });
  assert.ok(batches.length > 1);
  for (const batch of batches) assert.ok(batch.actions.length <= 5);
  // 批次下标连续、都有 goal
  batches.forEach((b, i) => {
    assert.equal(b.index, i + 1);
    assert.ok(b.goal.startsWith('学习通作业：'));
  });
});

test('多行文本里混入换行符会给出警告', () => {
  const { warnings } = buildPlan(
    profile,
    [{ n: 11, kind: 'text', lines: ['a\nb'] }],
    { steps: [], verify: false },
  );
  assert.ok(warnings.some((w) => w.includes('换行符')));
});

test('提交闸门：默认不生成提交步骤，放开后才生成', () => {
  const closed = buildPlan(profile, [{ n: 1, option: 'A' }], {
    steps: ['draft', 'submit'],
    verify: false,
    allowSubmitStep: false,
  });
  const closedActions = closed.batches.flatMap((b) => b.actions);
  assert.equal(closedActions.some((a) => a.fromPoint && a.fromPoint[0] === 2474), false);
  assert.equal(closed.policy.submitIncluded, false);
  assert.ok(closed.warnings.some((w) => w.includes('安全闸门')));

  const open = buildPlan(profile, [{ n: 1, option: 'A' }], {
    steps: ['draft', 'submit'],
    verify: false,
    allowSubmitStep: true,
  });
  const openActions = open.batches.flatMap((b) => b.actions);
  assert.equal(openActions.some((a) => a.fromPoint && a.fromPoint[0] === 2474), true);
  assert.equal(open.policy.submitIncluded, true);
});

test('配置归一化会夹紧危险值', () => {
  const cfg = resolveConfig({ maxActionsPerBatch: 999, maxBatches: -3, allowSubmitStep: 'yes' });
  assert.equal(cfg.maxActionsPerBatch, 25);
  assert.equal(cfg.maxBatches, 1);
  assert.equal(cfg.allowSubmitStep, false);
  assert.equal(cfg.profileId, 'example-2560x1600');
  assert.equal(resolveConfig({}).enabled, true);
});
