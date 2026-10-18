/**
 * i18n.js — 界面与文案词条（zh-CN / en-US）
 *
 * 双模块：主进程 require，渲染进程 <script> 挂到 window.I18N。
 * 文案支持 {name}（宠物名）与 {owner}（主人称呼）占位符。
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var STRINGS = {
    'zh-CN': {
      ownerFallback: '主人',

      /* 托盘 / 右键菜单 */
      tray: {
        pet: '抚摸', feed: '喂食', play: '逗玩', call: '呼喊',
        bath: '洗澡',
        muted: '静音', status: '状态面板',
        settings: '设置', quit: '退出',
      },

      /* 状态面板 */
      panel: {
        interact: '互动',
        mood: '心情', food: '饱食', energy: '体力',
        clean: '清洁', affinity: '好感',
        ageUnset: '生日未设置',
        ageNewborn: '今天出生',
        ageUnderMonth: '不足 1 个月',
        ageDayY: '{y} 岁 {d} 天',
        ageDayD: '{d} 天',
        ageMonthY: '{y} 岁 {m} 个月',
        ageMonthM: '{m} 个月',
        /* 属性档位徽章（normal 档不显示） */
        tier: {
          hunger: { critical: '饿坏了', low: '有点饿', good: '很饱' },
          energy: { critical: '累瘫了', low: '有点困', good: '精神好' },
          happiness: { critical: '很难过', low: '有点闷', good: '很开心' },
          cleanliness: { critical: '很脏', low: '有点脏', good: '很干净' },
        },
      },

      /* 气泡文案 */
      bubbles: {
        welcome: ['喵~ 我来陪你啦！'],
        hungry: ['{owner}，肚子饿了…喵~', '有饭吃吗？', '{name}想吃东西了'],
        bored: ['好无聊，陪我玩玩~', '陪我玩会儿嘛！', '好想玩逗猫棒…'],
        lonely: ['{owner}去哪儿了？', '喵~ 来找你玩', '在干嘛呀，理理{owner}~'],
        pet: ['呼噜呼噜~', '好舒服~', '最喜欢{owner}了！'],
        play: ['接住小球！', '再来一次！', '好玩好玩~'],
        eat: ['好香！', '吧唧吧唧~', '谢谢{owner}！'],
        bath: ['洗香香啦~', '咕噜咕噜…泡泡好舒服', '变干净啦！'],
        wake: ['睡醒啦~', '伸个懒腰~'],
        sulk: ['哼…不高兴！', '（垂着尾巴生闷气）', '呜…有点难过…', '别理我，让我自己静静…'],

        /* 属性驱动的分级台词（needs-profile.js 决定何时取用） */
        need: {
          hunger: {
            critical: ['饿扁了…喵…', '{owner}，{name}快饿晕了…', '肚子咕咕叫，{name}好难受…'],
            low: ['{owner}，肚子饿了…喵', '有饭吃吗？', '{name}想吃东西了'],
            good: ['吃得好饱，好满足～', '肚子饱饱的，好幸福～'],
          },
          energy: {
            critical: ['眼皮好重…快睁不开了…', '一点力气都没有了…', '想马上趴下…'],
            low: ['有点困了…', '想眯一小会儿～', '可以打个盹吗？'],
            good: ['精神满满！', '睡饱了，元气满满～'],
          },
          happiness: {
            critical: ['呜…好难过…', '谁都不理我…', '尾巴都抬不起来了…'],
            low: ['好无聊，陪我玩玩～', '陪我玩会儿嘛！', '好想玩逗猫棒…'],
            good: ['今天心情超好！', '{owner}在真好～', '想跑两圈！'],
          },
          cleanliness: {
            critical: ['身上痒痒的，脏脏的…', '毛毛都打结了…', '想洗澡澡…'],
            criticalNoBath: ['身上痒痒的，脏脏的…', '毛毛都打结了…', '浑身不舒服…'],
            low: ['有点脏了呢…', '身上沾灰了，帮我洗洗？', '毛毛不蓬松了…'],
            lowNoBath: ['有点脏了呢…', '身上沾灰了…', '毛毛不蓬松了…'],
            good: ['刚洗完澡，香香的～', '毛毛亮晶晶的～'],
          },
        },

        /* 属性从「偏低/危」回升到正常或良好时的即时反馈 */
        recover: {
          hunger: ['吃饱饱，好幸福～', '肚子不饿了！'],
          energy: ['有力气啦！', '睡饱了，元气满满～'],
          happiness: ['开心起来了～', '心情变好了！'],
          cleanliness: ['身上干净啦～', '毛毛又蓬松了～'],
        },
      },
      say: {
        sleepy: '好困，睡一会儿~',
        ball: '小球来啦！',
        smell: '闻到饭香味~',
        callReply: '喵！我来啦~',
        sizePct: '大小 {n}%',
        maxSize: '已经是大喵形态啦，放不下啦~',
        minSize: '再小就要看不见啦~',
        atMax: '已到最大体型',
        atMin: '已到最小体型',
        sizeReset: '已恢复默认大小',
        bathStart: '要洗澡澡咯~',
        settingsSaved: ['设置已保存～', '都设置好啦～'],
      },

      /* 系统通知 */
      notify: {
        hungerLow: '{name} 肚子饿了，记得喂食哦',
        energyLow: '{name} 困了，想睡一会儿',
        happyLow: '{name} 好无聊，想玩逗猫棒',
        cleanLow: '{name} 身上脏了，该洗澡啦',
        alone: '{name} 想你了，回来看看吧',
      },

      /* 设置窗口（chrome 部分；条目标签在 config-schema 中） */
      settings: {
        title: '设置 — {name}',
        groupIntro: {
          pet: '给宠物起名、设定称呼与体型。',
          startup: '控制开机行为与窗口位置的记忆策略。',
          interact: '鼠标、滚轮与快捷键的响应方式。',
          sound: '音效、气泡与系统通知的开关与强度。',
          appear: '配色、语言、字号与动效偏好。',
          behavior: '无交互时宠物的活跃程度与自主行为边界。',
          needs: '每种属性各自的下降速度，以及趴睡节律的粗调。',
          ai: '无人打扰时，让猫自己开口讲点什么；不需要输入，也不会追问你。',
          data: '配置文件的位置、保存节奏与备份策略。',
        },
        apply: '应用', cancel: '取消', reset: '恢复默认设置',
        dirty: '{n} 项已修改',
        appliedToast: '✓ 设置已保存', appliedBtn: '✓ 已应用', cancelledBtn: '✓ 已取消',
        applyFailed: '保存失败：{reason}',
        reverted: '已还原为上次保存的设置',
        discardTitle: '放弃未保存的更改？',
        discardBody: '有 {n} 项修改尚未保存，放弃后无法恢复。',
        discardOk: '放弃更改', discardKeep: '继续编辑',
        unsavedClose: '还有未保存的更改，关闭后将丢失这些修改。',
        needRestart: '有 {n} 项需重启后生效', restartNow: '立即重启',
        saved: '已保存到配置文件',
        discarded: '已放弃未保存的改动',
        resetDone: '已恢复全部默认设置',
        keepPetName: '保留宠物名字',
        resetConfirm: '确定要把全部设置恢复为默认值吗？',
        nameEmpty: '名字不能为空，将回退为默认「{d}」',
        browse: '浏览…', openFolder: '打开目录',
        exportCfg: '导出配置…', importCfg: '导入配置…', migrate: '迁移并重启',
        importOk: '配置已导入并生效',
        importBad: '导入失败：{reason}',
        dirOk: '数据目录已切换，重启后生效',
        dirBad: '目录不可用：{reason}',
        restartSoon: '应用即将重启…',
        badgeRestart: '重启后生效', badgeLogin: '下次登录生效',
      },
    },

    'en-US': {
      ownerFallback: 'human',

      tray: {
        pet: 'Pet', feed: 'Feed', play: 'Play', call: 'Call over',
        bath: 'Bath',
        muted: 'Mute', status: 'Status panel',
        settings: 'Settings', quit: 'Quit',
      },

      /* 状态面板 */
      panel: {
        interact: 'Interact',
        mood: 'Mood', food: 'Food', energy: 'Energy',
        clean: 'Clean', affinity: 'Bond',
        ageUnset: 'No birthday set',
        ageNewborn: 'Newborn today',
        ageUnderMonth: 'Under 1 month',
        ageDayY: '{y}y {d}d',
        ageDayD: '{d} days',
        ageMonthY: '{y}y {m}mo',
        ageMonthM: '{m} months',
        tier: {
          hunger: { critical: 'Starving', low: 'Hungry', good: 'Well fed' },
          energy: { critical: 'Exhausted', low: 'Sleepy', good: 'Energetic' },
          happiness: { critical: 'Miserable', low: 'Bored', good: 'Happy' },
          cleanliness: { critical: 'Filthy', low: 'Dusty', good: 'Clean' },
        },
      },

      bubbles: {
        welcome: ['Meow~ here to keep you company!'],
        hungry: ['{owner}, my tummy is rumbling…', 'Is it dinner time yet?', '{name} wants food'],
        bored: ['So bored… play with me?', 'Come on, play with me!', 'I miss the feather wand…'],
        lonely: ['Where did {owner} go?', 'Meow~ come play with me', 'What are you up to? Notice me, {owner}~'],
        pet: ['Purrrr~', 'That feels great~', 'Love you, {owner}!'],
        play: ['Catch the ball!', 'One more time!', 'So much fun!'],
        eat: ['Yum!', 'Nom nom nom~', 'Thank you, {owner}!'],
        bath: ['Squeaky clean~', 'Bubbly bubbly… so warm', 'All clean now!'],
        wake: ['Good nap~', 'Time to stretch~'],
        sulk: ['Hmph… not happy!', '(sulking with drooping tail)', 'Sigh… feeling down…', 'Leave me alone for a while…'],

        need: {
          hunger: {
            critical: ['I am starving… meow…', '{owner}, {name} is about to faint…', 'My tummy keeps rumbling, {name} feels awful…'],
            low: ['{owner}, my tummy is rumbling…', 'Is it dinner time yet?', '{name} wants food'],
            good: ['That was a good meal~', 'Nice and full, so happy~'],
          },
          energy: {
            critical: ['My eyes are so heavy…', 'I have no strength left…', 'I need to lie down right now…'],
            low: ['Getting a bit sleepy…', 'Just a tiny nap~', 'May I doze off for a bit?'],
            good: ['Full of energy!', 'Well rested and bouncy~'],
          },
          happiness: {
            critical: ['Sigh… I feel awful…', 'Nobody plays with me…', 'I cannot even lift my tail…'],
            low: ['So bored… play with me?', 'Come on, play with me!', 'I miss the feather wand…'],
            good: ['Feeling great today!', 'It is so nice having {owner} around~', 'I want to run a couple of laps!'],
          },
          cleanliness: {
            critical: ['I feel itchy and grubby…', 'My fur is all matted…', 'I want a bath…'],
            criticalNoBath: ['I feel itchy and grubby…', 'My fur is all matted…', 'I feel so uncomfortable…'],
            low: ['Getting a bit dusty…', 'I am covered in dust — help me wash?', 'My fur is not fluffy anymore…'],
            lowNoBath: ['Getting a bit dusty…', 'I am covered in dust…', 'My fur is not fluffy anymore…'],
            good: ['Just had a bath, smell so nice~', 'My fur is all shiny~'],
          },
        },

        recover: {
          hunger: ['Nice and full, so happy~', 'Not hungry anymore!'],
          energy: ['I have my strength back!', 'Well rested and bouncy~'],
          happiness: ['Feeling better now~', 'My mood improved!'],
          cleanliness: ['All clean now~', 'My fur is fluffy again~'],
        },
      },
      say: {
        sleepy: 'So sleepy… napping a bit~',
        ball: 'Ball incoming!',
        smell: 'I smell food~',
        callReply: 'Meow! Coming!',
        sizePct: 'Size {n}%',
        maxSize: 'I am already the biggest cat there is~',
        minSize: 'Any smaller and I will disappear~',
        atMax: 'Already at maximum size',
        atMin: 'Already at minimum size',
        sizeReset: 'Size reset to default',
        bathStart: 'Bath time~',
        settingsSaved: ['Settings saved~', 'All set~'],
      },

      notify: {
        hungerLow: '{name} is hungry — time for a meal',
        energyLow: '{name} is sleepy and wants a nap',
        happyLow: '{name} is bored and wants to play',
        cleanLow: '{name} is dirty — time for a bath',
        alone: '{name} misses you — come back soon',
      },

      settings: {
        title: 'Settings — {name}',
        groupIntro: {
          pet: 'Name your pet, set how it addresses you, and adjust its size.',
          startup: 'Launch behaviour and whether the window position is remembered.',
          interact: 'How the pet responds to the mouse, the wheel and hotkeys.',
          sound: 'Toggles and intensity for sound, bubbles and notifications.',
          appear: 'Colours, language, text scaling and motion preferences.',
          behavior: 'How active the pet is on its own.',
          needs: 'How fast each need drops over time, and how the pet rests.',
          ai: 'Let the pet speak up on its own when you are away. No input, no questions.',
          data: 'Where data lives, how often it is saved, and backups.',
        },
        apply: 'Apply', cancel: 'Cancel', reset: 'Reset to defaults',
        dirty: '{n} change(s)',
        appliedToast: '✓ Settings saved', appliedBtn: '✓ Applied', cancelledBtn: '✓ Cancelled',
        applyFailed: 'Save failed: {reason}',
        reverted: 'Restored last saved settings',
        discardTitle: 'Discard unsaved changes?',
        discardBody: '{n} change(s) are not saved yet. This cannot be undone.',
        discardOk: 'Discard', discardKeep: 'Keep editing',
        unsavedClose: 'You have unsaved changes. Closing now will lose them.',
        needRestart: '{n} change(s) need a restart', restartNow: 'Restart now',
        saved: 'Saved to config file',
        discarded: 'Unsaved changes discarded',
        resetDone: 'All settings reset to defaults',
        keepPetName: 'Keep pet name',
        resetConfirm: 'Reset all settings to their defaults?',
        nameEmpty: 'Name cannot be blank — will fall back to “{d}”',
        browse: 'Browse…', openFolder: 'Open folder',
        exportCfg: 'Export…', importCfg: 'Import…', migrate: 'Migrate & restart',
        importOk: 'Configuration imported',
        importBad: 'Import failed: {reason}',
        dirOk: 'Data folder changed — takes effect after restart',
        dirBad: 'Folder unavailable: {reason}',
        restartSoon: 'Restarting…',
        badgeRestart: 'Restart to apply', badgeLogin: 'Applies next sign-in',
      },
    },
  };

  var FALLBACK = 'zh-CN';

  function t(lang, key, params) {
    var cur = STRINGS[lang] || STRINGS[FALLBACK];
    var parts = key.split('.');
    var v = cur;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) break;
      v = v[parts[i]];
    }
    if (v == null) {
      v = STRINGS[FALLBACK];
      for (var j = 0; j < parts.length; j++) {
        if (v == null) break;
        v = v[parts[j]];
      }
    }
    if (v == null) return key;
    if (params) {
      Object.keys(params).forEach(function (p) {
        v = String(v).replace(new RegExp('\\{' + p + '\\}', 'g'), params[p]);
      });
    }
    return v;
  }

  /** 取数组词条（如气泡句库）中的一条；params 在选中句子后替换 */
  function pick(lang, key, params) {
    // 注意：不能把 params 传给 t()——t() 会把数组整体 String() 化
    var arr = t(lang, key);
    if (!Array.isArray(arr) || !arr.length) return String(arr);
    var s = arr[Math.floor(Math.random() * arr.length)];
    if (params) {
      Object.keys(params).forEach(function (p) {
        s = String(s).replace(new RegExp('\\{' + p + '\\}', 'g'), params[p]);
      });
    }
    return s;
  }

  return { STRINGS: STRINGS, t: t, pick: pick, fallback: FALLBACK };
});
