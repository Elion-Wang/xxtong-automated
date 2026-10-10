// preset-plus（@rain-kl/dsh-preset-plus）的预设：读取、导出、安装。
//
// preset-plus 把预设存在 $DSH_HOME/preset-plus.json：
//   { "version": 1, "activePresetId": "…", "presets": { "<id>": { …预设… } } }
// 单个预设的形状：
//   { "id": "…", "name": "…", "autoMode": true, "entries": [ { "role": "system", "text": "…" } ] }
//
// 安装 = 把本包的预设合并进 presets 字段。因为 preset-plus.json 里可能还有
// 用户自己的攒的其它预设，所以安装前一定先备份，而且要把 confirm 显式传进来。

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT } from './layout.js';

export const PRESET_ID = 'xxtong-automated';
export const PRESET_PATH = join(PACKAGE_ROOT, 'presets', PRESET_ID + '.json');

export function presetPlusPath(dshHome) {
  const home = dshHome || process.env.DSH_HOME || process.cwd();
  return join(home, 'preset-plus.json');
}

export async function loadPreset() {
  const text = await readFile(PRESET_PATH, 'utf8');
  return validatePreset(JSON.parse(text));
}

// 预设至少要满足 preset-plus 的字段约定，否则导入面板会报错
export function validatePreset(preset) {
  if (!preset || typeof preset !== 'object') throw new Error('预设不是对象');
  if (!preset.id || typeof preset.id !== 'string') throw new Error('预设缺少 id');
  if (!Array.isArray(preset.entries) || !preset.entries.length) {
    throw new Error('预设缺少 entries');
  }
  for (const [i, entry] of preset.entries.entries()) {
    if (!entry || typeof entry.role !== 'string' || typeof entry.text !== 'string') {
      throw new Error('entries[' + i + '] 需要 { role, text }');
    }
  }
  return preset;
}

async function readPresetPlusFile(file) {
  try {
    const text = await readFile(file, 'utf8');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

// 看这份预设现在有没有装进 preset-plus
export async function presetStatus(dshHome) {
  const file = presetPlusPath(dshHome);
  const store = await readPresetPlusFile(file);
  const installed = Boolean(store && store.presets && store.presets[PRESET_ID]);
  return {
    file,
    exists: Boolean(store),
    installed,
    activePresetId: store ? store.activePresetId ?? null : null,
    presets: store && store.presets ? Object.keys(store.presets) : [],
    presetPath: PRESET_PATH,
  };
}

// 导出预设本体（默认只返回内容；给了 target 就顺便写一份文件出来）
export async function exportPreset(target) {
  const preset = await loadPreset();
  if (!target) return { preset };
  await mkdir(join(target, '..'), { recursive: true }).catch(() => {});
  await writeFile(target, JSON.stringify(preset, null, 2) + '\n', 'utf8');
  return { preset, file: target };
}

// 合并安装到 $DSH_HOME/preset-plus.json。必须显式 confirm=true。
export async function installPreset(dshHome, { confirm } = {}) {
  if (confirm !== true) {
    throw new Error('安装会修改 preset-plus.json，需要显式 confirm=true');
  }
  const preset = await loadPreset();
  const file = presetPlusPath(dshHome);
  const store = (await readPresetPlusFile(file)) || { version: 1, presets: {} };
  if (!store.presets || typeof store.presets !== 'object') store.presets = {};
  if (typeof store.version !== 'number') store.version = 1;

  let backup = null;
  if (store.presets[PRESET_ID] || Object.keys(store.presets).length) {
    // 只备份已经存在的文件；不存在就没有可丢的东西
    const existingText = await readFile(file, 'utf8').catch(() => null);
    if (existingText !== null) {
      backup = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
      await copyFile(file, backup);
    }
  }

  const beforeActive = store.activePresetId ?? null;
  store.presets[PRESET_ID] = preset;
  // 故意不改 activePresetId：激活哪个预设由用户在 preset-plus 面板里自己决定
  await mkdir(join(file, '..'), { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify(store, null, 2) + '\n', 'utf8');

  return {
    file,
    backup,
    installedId: PRESET_ID,
    activePresetId: beforeActive,
    presets: Object.keys(store.presets),
    hint: '预设已并入 preset-plus.json。请在 DSH 的 preset-plus 面板里激活「' + preset.name + '」。',
  };
}
