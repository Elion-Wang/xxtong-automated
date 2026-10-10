// 工具层的冒烟测试：用一个假的 cordis ctx 把四个工具注册起来，
// 再分别调用它们的 execute，验证返回结构、安全闸门与文件副作用。
//
// 这样即使不启动 DSH，也能确认插件的集成契约没写错。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { registerXxtongTools } from '../src/host/tools.js';
import { resolveConfig } from '../src/host/config.js';

function makeCtx() {
  const tools = new Map();
  return {
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error('工具重名：' + definition.name);
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    logger: { info() {}, warn() {} },
    toolsMap: tools,
  };
}

async function setup(rawConfig = {}) {
  const dshHome = await mkdtemp(join(tmpdir(), 'xxtong-'));
  const ctx = makeCtx();
  const config = resolveConfig(rawConfig);
  const disposers = registerXxtongTools(ctx, config, { dshHome });
  return { ctx, config, dshHome, disposers };
}

test('注册四个工具，并且 disposer 能全部撤销', async () => {
  const { ctx, disposers } = await setup();
  assert.deepEqual([...ctx.toolsMap.keys()].sort(), [
    'xxtong_layout_check',
    'xxtong_plan',
    'xxtong_preset',
    'xxtong_profile',
  ]);
  for (const dispose of disposers) dispose();
  assert.equal(ctx.toolsMap.size, 0);
});

test('xxtong_profile：list / convert / get 都能用', async () => {
  const { ctx } = await setup();
  const profile = ctx.toolsMap.get('xxtong_profile');

  const list = await profile.execute({ action: 'list' });
  assert.equal(list.ok, true);
  assert.ok(list.profiles.some((p) => p.id === 'example-2560x1600' && p.source === 'builtin'));

  const converted = await profile.execute({
    action: 'convert',
    point: [1000, 500],
    from: 'image',
  });
  assert.deepEqual(converted.physical, [1600, 800]);
  assert.deepEqual(converted.image, [1000, 500]);

  const got = await profile.execute({ action: 'get' });
  assert.equal(got.ok, true);
  assert.equal(got.window.title, '学习通');
  // 判断题 1-10 应该都有格子坐标
  const judge = got.sections.find((s) => s.group === 'judge');
  assert.equal(judge.navCells.length, 10);
  assert.deepEqual(judge.navCells.at(-1), { n: 10, point: [2178, 424] });
});

test('xxtong_profile：derive 后可以存到本机目录', async () => {
  const { ctx, dshHome } = await setup();
  const profile = ctx.toolsMap.get('xxtong_profile');

  const derived = await profile.execute({
    action: 'derive',
    target: { physicalWidth: 2560, physicalHeight: 1440 },
  });
  assert.equal(derived.profile.screen.physicalHeight, 1440);
  assert.equal(derived.profile.content.optionY.B, 374.4);

  const saved = await profile.execute({
    action: 'save',
    saveAs: 'local-2560x1440',
    profile: derived.profile,
  });
  assert.equal(saved.ok, true);
  assert.match(saved.file, /xxtong-automated[\\/]+profiles[\\/]+local-2560x1440\.json$/);

  const again = await profile.execute({ action: 'list' });
  assert.ok(again.profiles.some((p) => p.id === 'local-2560x1440' && p.source === 'user'));

  // 落在 $DSH_HOME 下的临时目录里，不写进包目录
  const files = await readdir(join(dshHome, 'xxtong-automated', 'profiles'));
  assert.deepEqual(files, ['local-2560x1440.json']);
});

test('xxtong_profile：非法标定档 id 被拒绝', async () => {
  const { ctx } = await setup();
  const profile = ctx.toolsMap.get('xxtong_profile');
  const bad = await profile.execute({ action: 'get', profileId: '../../etc/passwd' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不合法/);
});

test('xxtong_plan：生成分批动作，默认不含提交', async () => {
  const { ctx } = await setup();
  const plan = ctx.toolsMap.get('xxtong_plan');

  const result = await plan.execute({
    answers: [
      { n: 2, option: 'A' },
      { n: 13, kind: 'text', lines: ["print(ord('A'))", '# 输出 65'] },
    ],
    steps: ['draft', 'submit'],
    verify: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.window, '学习通');
  assert.ok(result.batches.length >= 1);
  const all = result.batches.flatMap((b) => b.actions);
  assert.equal(all.some((a) => a.fromPoint && a.fromPoint[0] === 2474), false);
  assert.equal(result.safety.submitIncluded, false);
  // 每批都不超过配置上限
  for (const batch of result.batches) {
    assert.ok(batch.actions.length <= result.policy.maxActionsPerBatch);
  }
  // 简答题那一段应该有逐行输入
  const texts = all.filter((a) => a.type === 'type_text').map((a) => a.text);
  assert.deepEqual(texts, ["print(ord('A'))", '# 输出 65']);
});

test('xxtong_plan：放开闸门后才生成提交步骤', async () => {
  const { ctx } = await setup({ allowSubmitStep: true });
  const plan = ctx.toolsMap.get('xxtong_plan');
  const result = await plan.execute({
    answers: [{ n: 1, option: 'A' }],
    steps: ['draft', 'submit'],
    verify: false,
  });
  const all = result.batches.flatMap((b) => b.actions);
  assert.equal(all.some((a) => a.fromPoint && a.fromPoint[0] === 2474), true);
  assert.equal(result.policy.submitIncluded, true);
});

test('xxtong_plan：空 answers 报错', async () => {
  const { ctx } = await setup();
  const result = await ctx.toolsMap.get('xxtong_plan').execute({ answers: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /answers/);
});

test('xxtong_preset：install 需要 confirm，并且会备份原有文件', async () => {
  const { ctx, dshHome } = await setup();
  const preset = ctx.toolsMap.get('xxtong_preset');

  // 先造一份「用户自己的」preset-plus.json
  const store = {
    version: 1,
    activePresetId: 'my-own',
    presets: { 'my-own': { id: 'my-own', name: '我自己的预设', autoMode: false, entries: [] } },
  };
  const file = join(dshHome, 'preset-plus.json');
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8');

  const refused = await preset.execute({ action: 'install' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /confirm/);

  const status0 = await preset.execute({ action: 'status' });
  assert.equal(status0.installed, false);
  assert.deepEqual(status0.presets, ['my-own']);

  const installed = await preset.execute({ action: 'install', confirm: true });
  assert.equal(installed.ok, true);
  assert.ok(installed.backup && installed.backup.includes('.bak-'));
  assert.equal(installed.activePresetId, 'my-own');

  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(after.presets).sort(), ['my-own', 'xxtong-automated']);
  assert.equal(after.activePresetId, 'my-own'); // 不替用户改激活项
  assert.ok(after.presets['xxtong-automated'].entries.length >= 2);

  const status1 = await preset.execute({ action: 'status' });
  assert.equal(status1.installed, true);

  const backups = (await readdir(dshHome)).filter((n) => n.includes('.bak-'));
  assert.equal(backups.length, 1);
});

test('xxtong_layout_check：给单题看落点', async () => {
  const { ctx } = await setup();
  const check = ctx.toolsMap.get('xxtong_layout_check');
  const one = await check.execute({ question: 23 });
  assert.equal(one.ok, true);
  assert.deepEqual(one.navPoint, [2178, 854]);
  assert.deepEqual(one.optionPoints.C, [560, 493]);

  const all = await check.execute({});
  assert.equal(all.ok, true);
  assert.equal(all.navigate.length, 3);
  assert.deepEqual(all.buttons.submit, [2474, 149]);
});
