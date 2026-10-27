var config = require('../../config.js');
var request = require('../../utils/request.js').request;

// 前置条件判断（同 H5 Question.dependsOn：equals / notEquals / contains）
// 另含 H5 questions/page.tsx 的硬编码规则：男性不显示孕期/经期题
function isQuestionVisible(q, answers) {
  if (answers && answers.gender === 'male' && (q.fieldName === 'pregnancy' || q.fieldName === 'menstrualCycle')) {
    return false;
  }
  if (!q.dependsOn) return true;
  var dep = q.dependsOn;
  var val = answers[dep.field];
  var op = dep.operator || 'equals';
  var target = dep.value;
  if (op === 'notEquals') return val !== target;
  if (op === 'contains') {
    if (Array.isArray(val)) {
      if (Array.isArray(target)) return target.some(function (t) { return val.indexOf(t) > -1; });
      return val.indexOf(target) > -1;
    }
    return val === target;
  }
  if (Array.isArray(target)) return target.indexOf(val) > -1;
  return val === target;
}

Page({
  data: {
    loading: true,
    loadError: '',
    // 测肤次数预检拦截（H5 questions/page.tsx 同口径：requireLogin / lifetime / day）
    limitBlocked: false,
    limitRequireLogin: false,
    limitTitle: '',
    limitMessage: '',
    phase: 'gender',      // gender（第 0 步：性别选择）→ quiz（答题）
    questions: [],        // 接口原始题目
    visibleQuestions: [], // 按 dependsOn 过滤后
    current: 0,
    question: null,
    displayOptions: [],   // 带 checked 标记的选项（WXML 不支持 indexOf，勾选态预算好）
    answers: {},
    multiDraft: [],       // 多选题当前勾选
    maxSelect: 0,         // 多选上限（0 为不限）
    progressPercent: 0,
  },

  onLoad: function () {
    this._advancing = false;
    this._advanceTimer = null;
    this.fetchQuestions();
    this.checkLimit();
  },

  onUnload: function () {
    if (this._advanceTimer) {
      clearTimeout(this._advanceTimer);
      this._advanceTimer = null;
    }
  },

  fetchQuestions: function () {
    var self = this;
    self.setData({ loading: true, loadError: '' });
    // GET /api/advisor/questions 返回题目数组本体（非 {success,data} 包装，见 H5 questions/route.ts）
    request({
      base: 'advisory',
      url: '/api/advisor/questions',
      method: 'GET',
      skipAuth: true,
      showError: false,
    }).then(function (list) {
      if (!Array.isArray(list) || list.length === 0) {
        self.setData({ loading: false, loadError: '题目加载失败，请重试' });
        return;
      }
      self.setData({ questions: list, loading: false });
      self.refreshVisible(0);
    }).catch(function (err) {
      self.setData({ loading: false, loadError: err.message || '题目加载失败，请重试' });
    });
  },

  // 测肤次数预检：进页即查，避免用户走完拍摄流程才在 analyze 阶段被拒
  // 服务端按会员等级返回 canTest / requireLogin / quotaPeriod / error（usage-limit.ts）
  checkLimit: function () {
    var self = this;
    request({
      base: 'advisory',
      url: '/api/advisor/test-limit',
      method: 'GET',
      showError: false,
    }).then(function (data) {
      if (!data || data.canTest) return;
      if (data.accountDisabled) {
        self.setData({
          limitBlocked: true,
          limitRequireLogin: false,
          limitTitle: '测肤功能已被限制',
          limitMessage: data.error || data.message || '账号已被限制使用测肤功能，请联系客服',
        });
        return;
      }
      var requireLogin = !!data.requireLogin;
      self.setData({
        limitBlocked: true,
        limitRequireLogin: requireLogin,
        limitTitle: requireLogin
          ? '测肤需登录后使用'
          : (data.quotaPeriod === 'lifetime' ? '测肤次数已用完' : '今日次数已用完'),
        limitMessage: data.error || data.message || '今日测试次数已用完，请明天再试。',
      });
    }).catch(function () {
      // 预检失败不阻塞主流程：analyze 阶段服务端会再次校验（H5 同口径）
    });
  },

  // 根据当前 answers 重新计算可见题目，并定位到指定下标
  refreshVisible: function (index) {
    var answers = this.data.answers;
    var visible = this.data.questions.filter(function (q) { return isQuestionVisible(q, answers); });
    var safeIndex = Math.min(index, visible.length - 1);
    var question = visible[safeIndex] || null;
    var percent = visible.length ? Math.round(((safeIndex + 1) / visible.length) * 100) : 0;
    this.setData({
      visibleQuestions: visible,
      current: safeIndex,
      question: question,
      multiDraft: [],
      maxSelect: question && question.id === 'primaryConcern' ? 3 : 0,
      progressPercent: percent,
    }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    });
    this.refreshDisplayOptions();
  },

  // 计算当前题每个选项的 checked 状态
  refreshDisplayOptions: function () {
    var q = this.data.question;
    if (!q) {
      this.setData({ displayOptions: [] });
      return;
    }
    var answers = this.data.answers;
    var multiDraft = this.data.multiDraft;
    var display = (q.options || []).map(function (opt) {
      var checked = q.type === 'multiple'
        ? multiDraft.indexOf(opt.value) > -1
        : answers[q.fieldName] === opt.value;
      return {
        value: opt.value,
        label: opt.label,
        description: opt.description || '',
        checked: checked,
      };
    });
    this.setData({ displayOptions: display });
  },

  // 单选：选中即进入下一题
  onSingleTap: function (e) {
    if (this._advancing) return;
    this._advancing = true;
    var self = this;
    var value = e.currentTarget.dataset.value;
    var q = this.data.question;
    var answers = Object.assign({}, this.data.answers);
    answers[q.fieldName] = value;
    this.setData({ answers: answers });
    this.refreshDisplayOptions();
    // 让选中态和勾选反馈可见，再进入下一题
    self._advanceTimer = setTimeout(function () {
      self._advanceTimer = null;
      self._advancing = false;
      self.next();
    }, 140);
  },

  // 多选：切换勾选，点"下一题"确认
  onMultiTap: function (e) {
    var value = e.currentTarget.dataset.value;
    var draft = this.data.multiDraft.slice();
    var idx = draft.indexOf(value);
    if (idx > -1) {
      draft.splice(idx, 1);
    } else {
      if (this.data.maxSelect > 0 && draft.length >= this.data.maxSelect) {
        wx.showToast({ title: '最多选择 ' + this.data.maxSelect + ' 项', icon: 'none' });
        return;
      }
      draft.push(value);
    }
    this.setData({ multiDraft: draft });
    this.refreshDisplayOptions();
  },

  onMultiConfirm: function () {
    if (this._advancing) return;
    var q = this.data.question;
    if (this.data.multiDraft.length === 0) {
      wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }
    this._advancing = true;
    var self = this;
    var answers = Object.assign({}, this.data.answers);
    answers[q.fieldName] = this.data.multiDraft.slice();
    this.setData({ answers: answers });
    self._advanceTimer = setTimeout(function () {
      self._advanceTimer = null;
      self._advancing = false;
      self.next();
    }, 80);
  },

  next: function () {
    var nextIndex = this.data.current + 1;
    if (nextIndex >= this.data.visibleQuestions.length) {
      this.finish();
    } else {
      this.refreshVisible(nextIndex);
    }
  },

  // 第 0 步：性别选择（选中即进入答题；写入 answers.gender，H5 analyze schema 的 answers.gender 字段）
  onGenderTap: function (e) {
    var value = e.currentTarget.dataset.value;
    var answers = Object.assign({}, this.data.answers);
    answers.gender = value;
    // 与 H5 一致：选男时清除孕期/经期答案（题目不再展示）
    if (value === 'male') {
      delete answers.pregnancy;
      delete answers.menstrualCycle;
    }
    this.setData({ answers: answers, phase: 'quiz' });
    // 性别影响题目可见性（男隐藏孕期/经期题），重算可见题目
    this.refreshVisible(this.data.current);
  },

  onPrev: function () {
    if (this._advancing) return;
    if (this.data.current > 0) {
      this.refreshVisible(this.data.current - 1);
    } else {
      // 第一题再点"上一题"回到性别选择
      this.setData({ phase: 'gender' }, function () {
        wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      });
    }
  },

  finish: function () {
    // answers 需非空对象（H5 AnalyzeRequestSchema refine 校验）
    wx.setStorageSync(config.STORAGE_KEYS.ANSWERS, this.data.answers);
    wx.navigateTo({ url: '/pages/capture/capture' });
  },

  // 拦截卡按钮：去登录（requireLogin 兜底）/ 返回首页
  onGoLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onBackHome: function () {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
