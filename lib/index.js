// 打包入口。package.json 的 main 指到这里，这里只做转发，
// 真正的逻辑都在 src/host/ 下，方便单独测试与阅读。

export { apply, inject, name, readFrontmatter, stripFrontmatter } from '../src/host/index.js';
export {
  CONFIG_DEFAULTS,
  resolveConfig,
  promptFragment,
} from '../src/host/config.js';
export {
  BUILTIN_PROFILE_DIR,
  PACKAGE_ROOT,
  buildPlan,
  editorPoint,
  listProfiles,
  loadProfile,
  navCell,
  optionPoint,
  saveProfile,
  scaleProfile,
  sectionForNumber,
  toImage,
  toPhysical,
  userProfileDir,
} from '../src/host/layout.js';
export {
  PRESET_ID,
  exportPreset,
  installPreset,
  presetPlusPath,
  presetStatus,
} from '../src/host/preset.js';
