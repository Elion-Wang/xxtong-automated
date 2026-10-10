// 插件配置：默认值与归一化。
//
// 配置来自 cordis.patch.yml 里的 config 段。用户也可以在
// $DSH_HOME/profiles/<profile>/cordis.patch.yml 里用同一个 id 重述整行来覆盖。
// 这里只做「填默认值 + 夹紧到安全范围」，不做任何文件访问。

export const CONFIG_DEFAULTS = {
  // 总开关。关掉后三个工具仍然存在，但 xxtong_plan 会直接返回 disabled。
  enabled: true,
  // 标定档 id，对应本包 profiles/*.json 或 $DSH_HOME/xxtong-automated/profiles/*.json。
  profileId: 'example-2560x1600',
  // 一个动作批次里最多几个动作。dsh-computer-use-windows 默认上限是 25，
  // 超了整批会被拒（too-many-actions），所以这里也按 25 夹紧。
  maxActionsPerBatch: 25,
  // 一次计划最多几个批次，防止计划无限长。
  maxBatches: 40,
  // 安全闸门：false 时绝不生成提交步骤，只生成暂存步骤。
  allowSubmitStep: false,
  // 注册运行时技能（读包根目录的 SKILL.md）。
  registerSkill: true,
  // 注入一段系统提示，提醒先读 SKILL.md 再动手。
  registerPrompt: true,
};

// 夹紧到 [lo, hi]，非数字时回落到 fallback
function clampInt(value, fallback, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

// 把外部传进来的原始配置归一化成一份完整、安全的配置
export function resolveConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    profileId:
      typeof src.profileId === 'string' && src.profileId.trim()
        ? src.profileId.trim()
        : CONFIG_DEFAULTS.profileId,
    maxActionsPerBatch: clampInt(
      src.maxActionsPerBatch,
      CONFIG_DEFAULTS.maxActionsPerBatch,
      1,
      25,
    ),
    maxBatches: clampInt(src.maxBatches, CONFIG_DEFAULTS.maxBatches, 1, 200),
    allowSubmitStep: src.allowSubmitStep === true,
    registerSkill: src.registerSkill !== false,
    registerPrompt: src.registerPrompt !== false,
  };
}

// 一段简短的系统提示。故意写得很克制：只讲纪律，不讲具体答案。
export function promptFragment(config) {
  return [
    '本会话装了 dsh-xxtong-automated（超星学习通作业自动化）。',
    '要驱动学习通 PC 客户端时：先读技能 xxtong-automated（SKILL.md），',
    '再用 computer_observe 观察窗口，用 xxtong_plan 生成动作批次，',
    '一批一次 computer_act（默认每批不超过 ' + config.maxActionsPerBatch + ' 个动作），',
    '每批做完用 screenshot 复核。',
    config.allowSubmitStep
      ? '当前配置允许生成提交步骤，但提交前仍然要用户点头。'
      : '本配置禁止生成提交步骤：只允许暂存，提交由用户手动完成。',
  ].join(' ');
}
