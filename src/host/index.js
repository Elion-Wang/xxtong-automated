// dsh-xxtong-automated 的宿主侧入口。
//
// 这个插件本身不驱动鼠标键盘：真正干活的是 dsh-computer-use-windows 暴露的
// computer_observe / computer_act。我们负责的是三件事：
//   1. 带上学习通 PC 客户端这套界面的坐标标定档（profiles/*.json）；
//   2. 把一份作业答案翻译成「一批一批、每批 <= 25 个动作」的 computer_act 计划；
//   3. 把配合 preset-plus 用的预设装进用户的 preset-plus.json（需显式确认）。
//
// 纪律（写进工具描述和技能里，刻意不做成「一键自动提交」）：
//   - 先观察再动手，坐标只从标定档里取，不猜；
//   - 一次 computer_act 的动作数不超过配置上限（默认 25，超了整批会被拒）；
//   - 默认只暂存，不提交；提交必须由用户明确点头，并手动完成或显式放开闸门。

import { resolveConfig, promptFragment } from './config.js';
import { PACKAGE_ROOT } from './layout.js';
import { registerXxtongTools } from './tools.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const name = 'dsh-xxtong-automated';

// 需要 tools 服务（注册工具）与 skills 服务（注册运行时技能）
export const inject = ['tools'];

export const SKILL_PATH = join(PACKAGE_ROOT, 'SKILL.md');

// 把 SKILL.md 的 YAML frontmatter 剥掉，只留正文
export function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const after = text.indexOf('\n', end + 1);
  return after === -1 ? '' : text.slice(after + 1).replace(/^\s+/, '');
}

// 从 frontmatter 里抠出 name / description（够用即可，不引 YAML 解析器）
export function readFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const head = text.slice(3, end);
  const out = {};
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  // DSH_HOME 由宿主注入到环境变量里；没有就退回当前工作目录
  const dshHome = process.env.DSH_HOME || process.cwd();

  if (!config.enabled) {
    ctx.logger?.info?.('dsh-xxtong-automated：配置 enabled=false，已跳过注册');
    return;
  }

  // 注册工具，并把 disposer 交给 ctx.effect 管理生命周期
  ctx.effect(() => {
    const disposers = registerXxtongTools(ctx, config, { dshHome });
    ctx.logger?.info?.(
      'dsh-xxtong-automated：已注册 xxtong_profile / xxtong_plan / xxtong_preset / xxtong_layout_check',
    );
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          // 卸载时任何单个工具清理失败都不该拖垮整个插件
        }
      }
    };
  });

  // 注册运行时技能（读包根目录的 SKILL.md）
  if (config.registerSkill && ctx.skills?.register) {
    ctx.effect(() => {
      let disposed = false;
      const disposeRef = { fn: null };
      readFile(SKILL_PATH, 'utf8')
        .then((text) => {
          if (disposed) return;
          const meta = readFrontmatter(text);
          disposeRef.fn = ctx.skills.register({
            name: meta.name || 'xxtong-automated',
            description:
              meta.description ||
              '超星学习通作业自动化：读题、作答、暂存的一步步流程与安全纪律。',
            whenToUse:
              '要驱动学习通 PC 客户端做作业（读题/选答案/填简答/暂存）时使用。',
            content: stripFrontmatter(text),
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'runtime',
            provider: name,
            resourceBase: {
              kind: 'opaque',
              description: 'dsh-xxtong-automated 的技能资源根目录',
            },
          });
        })
        .catch((error) => {
          ctx.logger?.warn?.('dsh-xxtong-automated：SKILL.md 读取失败，跳过技能注册', error);
        });
      return () => {
        disposed = true;
        disposeRef.fn?.();
      };
    });
  }

  // 注入一段系统提示
  if (config.registerPrompt && ctx.systemPrompt?.add) {
    ctx.effect(() => {
      const text = promptFragment(config);
      const dispose = ctx.systemPrompt.add(text);
      return () => dispose?.();
    });
  }
}
