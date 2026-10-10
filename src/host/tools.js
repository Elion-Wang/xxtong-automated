// 三个工具的注册入口。
//
// 这里的 ctx 是 cordis 的插件上下文；工具用 ctx.tools.register(definition) 注册，
// 返回值是 disposer。definition 的形状：
//   { name, description, parameters /* 原始 JSON Schema */, async execute(args, exec) }
// execute 的返回值会被序列化成工具结果，所以只返回 JSON 能表达的东西。

import {
  buildPlan,
  listProfiles,
  loadProfile,
  navCell,
  optionPoint,
  saveProfile,
  scaleProfile,
  sectionForNumber,
  toImage,
  toPhysical,
} from './layout.js';
import { exportPreset, installPreset, presetStatus, PRESET_ID } from './preset.js';

const PROFILE_LIST_HINT =
  '可用标定档见 xxtong_profile action=list。默认档是 2560x1600 的实测参考档。';

function ok(data) {
  return { ok: true, ...data };
}

function fail(error) {
  return { ok: false, error: String(error && error.message ? error.message : error) };
}

export function registerXxtongTools(ctx, config, { dshHome }) {
  const disposers = [];

  // ------------------------------------------------------------ xxtong_profile
  disposers.push(
    ctx.tools.register({
      name: 'xxtong_profile',
      description:
        '管理「学习通 PC 客户端」的屏幕坐标标定档。用于：查看当前标定档（get）、' +
        '按新分辨率派生一份（derive）、把派生结果存到本机（save）、列出可用档（list）、' +
        '在截图坐标与屏幕物理坐标之间换算（convert）。' +
        '标定档里只有坐标与布局信息，不含任何账号、日志或密钥。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'list', 'derive', 'save', 'convert'],
            description: '要做的操作',
          },
          profileId: {
            type: 'string',
            description: '标定档 id；不填就用插件配置里的 profileId',
          },
          target: {
            type: 'object',
            description: 'derive 用：目标屏幕的物理分辨率与截图尺寸',
            properties: {
              physicalWidth: { type: 'number' },
              physicalHeight: { type: 'number' },
              captureWidth: { type: 'number' },
              captureHeight: { type: 'number' },
            },
          },
          point: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            description: 'convert 用：[x, y]',
          },
          from: {
            type: 'string',
            enum: ['image', 'physical'],
            description: 'convert 用：输入点是截图坐标还是屏幕物理坐标，默认 image',
          },
          saveAs: {
            type: 'string',
            description: 'derive/save 用：存到本机时用的 id（只允许字母数字 . _ -）',
          },
          profile: {
            type: 'object',
            description: 'save 用：要保存的完整标定档对象',
          },
        },
        required: ['action'],
      },
      async execute(args = {}) {
        try {
          const action = String(args.action || 'get');
          const id = args.profileId || config.profileId;

          if (action === 'list') {
            const profiles = await listProfiles(dshHome);
            return ok({ profiles, default: config.profileId });
          }

          if (action === 'convert') {
            const profile = await loadProfile({ profileId: id, dshHome });
            const point = Array.isArray(args.point) ? args.point.map(Number) : null;
            if (!point || point.length !== 2 || !point.every(Number.isFinite)) {
              throw new Error('convert 需要 point: [x, y]');
            }
            const fromImage = (args.from || 'image') !== 'physical';
            const physical = fromImage ? toPhysical(profile, point) : point;
            const image = fromImage ? point : toImage(profile, point);
            return ok({
              profileId: profile.id,
              image,
              physical,
              scale: {
                x: profile.screen.physicalWidth / profile.screen.captureWidth,
                y: profile.screen.physicalHeight / profile.screen.captureHeight,
              },
            });
          }

          if (action === 'derive') {
            const base = await loadProfile({ profileId: id, dshHome });
            const derived = scaleProfile(base, args.target || {});
            return ok({
              profileId: derived.id,
              derivedFrom: base.id,
              profile: derived,
              hint:
                '想长期使用就再调一次 action=save（saveAs 换个 id，例如 local-2560x1440），' +
                '然后把 cordis.patch.yml 的 profileId 改成它。',
            });
          }

          if (action === 'save') {
            const profile = args.profile && typeof args.profile === 'object' ? args.profile : null;
            if (!profile) throw new Error('save 需要 profile 对象');
            const saved = await saveProfile(profile, {
              dshHome,
              id: args.saveAs || args.profileId || profile.id,
            });
            return ok({
              ...saved,
              hint: '本机标定档保存在 $DSH_HOME 下，不会写进插件包目录。',
            });
          }

          // 默认 get
          const profile = await loadProfile({ profileId: id, dshHome });
          const sections = (profile.sections || []).map((s) => ({
            ...s,
            navCells: Array.from({ length: s.to - s.from + 1 }, (_, i) => {
              const cell = navCell(profile, s.group, i);
              return cell ? { n: s.from + i, point: cell } : { n: s.from + i, point: null };
            }),
          }));
          return ok({
            profileId: profile.id,
            source: profile.source,
            label: profile.label || '',
            window: profile.window || null,
            screen: profile.screen,
            sections,
            content: profile.content,
            buttons: profile.buttons,
            editor: profile.editor,
            scroll: profile.scroll,
            note: PROFILE_LIST_HINT,
          });
        } catch (error) {
          return fail(error);
        }
      },
    }),
  );

  // -------------------------------------------------------------- xxtong_plan
  disposers.push(
    ctx.tools.register({
      name: 'xxtong_plan',
      description:
        '把一份学习通作业答案翻译成计算机操作计划：按题号跳题（点右侧答题卡）、' +
        '选选项、往富文本框逐行输入，并决定哪些步骤要先点「暂存」。' +
        '返回的每个 batch.actions 都应当整批作为一次 computer_act 下发（每批不超过 ' +
        '配置的动作上限）。计划里不会出现提交步骤，除非配置显式允许且调用方要求。',
      parameters: {
        type: 'object',
        properties: {
          answers: {
            type: 'array',
            description: '答案列表',
            items: {
              type: 'object',
              properties: {
                n: { type: 'integer', description: '题号（从 1 开始）' },
                kind: {
                  type: 'string',
                  enum: ['single', 'multi', 'text'],
                  description: 'single/multi 走选项点击；text 是简答题，走富文本框输入',
                },
                option: {
                  type: 'string',
                  description: 'single/multi 用：A/B/C/D',
                },
                lines: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'text 用：每一行一个元素。不要在一行里塞 \\n，换行由计划插入的 enter 按键完成',
                },
              },
              required: ['n'],
            },
          },
          profileId: { type: 'string', description: '标定档 id；不填用配置里的' },
          profile: {
            type: 'object',
            description: '直接用一份临时标定档（例如刚 derive 出来的），优先级高于 profileId',
          },
          steps: {
            type: 'array',
            items: { type: 'string', enum: ['draft', 'submit'] },
            description: '收尾步骤。默认 ["draft"]（点暂存）。submit 需要配置允许',
          },
          verify: {
            type: 'boolean',
            description: '是否在每道题之后插入一次 screenshot 复核，默认 true',
          },
          maxActionsPerBatch: { type: 'integer', description: '覆盖配置里的单批动作上限' },
          maxBatches: { type: 'integer', description: '覆盖配置里的批次数上限' },
        },
        required: ['answers'],
      },
      async execute(args = {}) {
        try {
          if (!config.enabled) {
            return ok({ disabled: true, note: '插件配置 enabled=false，未生成计划' });
          }
          const answers = Array.isArray(args.answers) ? args.answers : [];
          if (!answers.length) throw new Error('answers 不能为空');
          const profile =
            args.profile && typeof args.profile === 'object'
              ? args.profile
              : await loadProfile({ profileId: args.profileId || config.profileId, dshHome });

          const planned = buildPlan(profile, answers, {
            maxActionsPerBatch: args.maxActionsPerBatch ?? config.maxActionsPerBatch,
            maxBatches: args.maxBatches ?? config.maxBatches,
            verify: args.verify !== false,
            steps: args.steps,
            allowSubmitStep: config.allowSubmitStep,
          });

          return ok({
            profileId: profile.id,
            window: (profile.window && profile.window.title) || '学习通',
            profileSource: profile.source || 'inline',
            ...planned,
            usage:
              '对每个 batch：调用一次 computer_act({ window, actions: batch.actions, goal: batch.goal })，' +
              '然后看返回截图确认；不通过就用 batch.hint 里的思路重定位，而不是重试同样的坐标。',
            safety: {
              submitIncluded: planned.policy.submitIncluded,
              allowSubmitStep: config.allowSubmitStep,
              textInputRequiresFocus:
                '富文本框必须先点一下再输入；本计划已经在每题开头放了点入动作。',
            },
          });
        } catch (error) {
          return fail(error);
        }
      },
    }),
  );

  // ------------------------------------------------------------ xxtong_preset
  disposers.push(
    ctx.tools.register({
      name: 'xxtong_preset',
      description:
        '管理配合 preset-plus（@rain-kl/dsh-preset-plus）使用的预设：status 查看装没装、' +
        'export 导出预设本体、install 并入 $DSH_HOME/preset-plus.json（会先备份，必须 confirm=true）。' +
        '安装只写 preset-plus.json，不动这个文件里的其它预设，也不会替你激活哪一条。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'export', 'install'],
            description: '要做的操作',
          },
          confirm: {
            type: 'boolean',
            description: 'install 必须显式传 true —— 它会改 preset-plus.json',
          },
          target: {
            type: 'string',
            description: 'export 用：把预设写到这个文件路径；不填只返回内容',
          },
        },
        required: ['action'],
      },
      async execute(args = {}) {
        try {
          const action = String(args.action || 'status');
          if (action === 'status') {
            return ok({ presetId: PRESET_ID, ...(await presetStatus(dshHome)) });
          }
          if (action === 'export') {
            return ok({ presetId: PRESET_ID, ...(await exportPreset(args.target)) });
          }
          if (action === 'install') {
            const result = await installPreset(dshHome, { confirm: args.confirm === true });
            return ok({ presetId: PRESET_ID, ...result });
          }
          throw new Error('未知 action：' + action);
        } catch (error) {
          return fail(error);
        }
      },
    }),
  );

  // 额外给一个只读的布局自检工具，方便换机器时逐步核对标定档
  disposers.push(
    ctx.tools.register({
      name: 'xxtong_layout_check',
      description:
        '只读自检：给定标定档，打印每一段的答题卡格子坐标、选项点坐标、暂存/提交按钮坐标，' +
        '用于换机器后逐步核对（不改任何状态、不驱动界面）。',
      parameters: {
        type: 'object',
        properties: {
          profileId: { type: 'string' },
          profile: { type: 'object' },
          question: { type: 'integer', description: '可选：只看某一题的落点' },
        },
      },
      async execute(args = {}) {
        try {
          const profile =
            args.profile && typeof args.profile === 'object'
              ? args.profile
              : await loadProfile({ profileId: args.profileId || config.profileId, dshHome });
          const one = Number(args.question);
          if (Number.isInteger(one) && one > 0) {
            const section = sectionForNumber(profile, one);
            return ok({
              profileId: profile.id,
              question: one,
              section,
              navPoint: section ? navCell(profile, section.group, section.index) : null,
              optionPoints: {
                A: optionPoint(profile, 'A'),
                B: optionPoint(profile, 'B'),
                C: optionPoint(profile, 'C'),
                D: optionPoint(profile, 'D'),
              },
            });
          }
          return ok({
            profileId: profile.id,
            window: profile.window || null,
            screen: profile.screen,
            navigate: (profile.sections || []).map((s) => ({
              group: s.group,
              title: s.title,
              range: [s.from, s.to],
              cells: Array.from({ length: s.to - s.from + 1 }, (_, i) => ({
                n: s.from + i,
                point: navCell(profile, s.group, i),
              })),
            })),
            options: {
              A: optionPoint(profile, 'A'),
              B: optionPoint(profile, 'B'),
              C: optionPoint(profile, 'C'),
              D: optionPoint(profile, 'D'),
            },
            buttons: profile.buttons || null,
            editor: profile.editor || null,
            scroll: profile.scroll || null,
          });
        } catch (error) {
          return fail(error);
        }
      },
    }),
  );

  return disposers;
}
