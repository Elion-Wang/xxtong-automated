#!/usr/bin/env node
// 把本包带的 preset-plus 预设装进 $DSH_HOME/preset-plus.json。
//
// 用法：
//   node scripts/install-preset.mjs                 # 安装（等价于 --install）
//   node scripts/install-preset.mjs --dry-run       # 只看会发生什么，不写文件
//   node scripts/install-preset.mjs --dsh-home D:\somewhere\.dsh
//   node scripts/install-preset.mjs --export out.json   # 只导出预设本体
//
// 安装会先备份原来的 preset-plus.json（preset-plus.json.bak-<时间戳>），
// 只往 presets 里加/换本预设，不会改你的 activePresetId。

import { installPreset, exportPreset, presetStatus, PRESET_ID } from '../src/host/preset.js';

function parseArgs(argv) {
  const out = { dryRun: false, dshHome: undefined, export: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--install') out.dryRun = false;
    else if (arg === '--dsh-home') out.dshHome = argv[++i];
    else if (arg === '--export') out.export = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`用法：node scripts/install-preset.mjs [--dry-run] [--dsh-home <dir>] [--export <file>]`);
  process.exit(0);
}

const status = await presetStatus(args.dshHome);
console.log('preset-plus.json：' + status.file);
console.log('  文件存在：' + status.exists);
console.log('  本预设已装：' + status.installed);
console.log('  当前激活：' + (status.activePresetId ?? '（未设置）'));
console.log('  已有预设：' + (status.presets.length ? status.presets.join(', ') : '（无）'));

if (args.export) {
  const result = await exportPreset(args.export);
  console.log('已导出预设到：' + result.file);
  process.exit(0);
}

if (args.dryRun) {
  console.log('--dry-run：不会写入任何文件。去掉这个参数即真正安装。');
  process.exit(0);
}

const result = await installPreset(args.dshHome, { confirm: true });
console.log('已安装预设 ' + PRESET_ID + '：' + result.file);
if (result.backup) console.log('原文件已备份到：' + result.backup);
console.log(result.hint);
