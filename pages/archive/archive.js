// 测肤档案（对齐 H5 用户中心「护肤档案」面板）：
// 统计（连续/累计/最长打卡 + 测肤次数）+ 肌肤变化趋势 + 近30天打卡色带 + 护肤历程时间线 + 打卡表单
// 数据直连子站（Bearer）：/api/user/diary（聚合/分页/增删）、/api/user/skin-trends、/api/advisor/history
var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');
var account = require('../../utils/account.js');
var trend = require('../../utils/trend.js');

var ENTRIES_PAGE_SIZE = 30;
var TESTS_PAGE_SIZE = 50;
var MAX_TAGS = 5;
var BACKFILL_DAYS = 90; // 可补打卡窗口（与服务端写入窗口一致）

var STATE_KEYS = ['great', 'good', 'normal', 'bad', 'terrible'];
var STATE_META = {
  great: { label: '很好', color: '#4C8055' },
  good: { label: '不错', color: '#7A9A5B' },
  normal: { label: '一般', color: '#C9A86C' },
  bad: { label: '较差', color: '#D9730D' },
  terrible: { label: '很差', color: '#D44C47' },
};

// 预置标签（与 H5 CheckInModal 一致）：肌肤表现 + 其他因素
var SKIN_TAGS = ['出油', '干燥', '暗沉', '泛红', '痘痘', '闭口', '局部受损'];
var SITUATION_TAGS = ['熬夜', '换季', '姨妈期', '压力', '医美', '醉酒', '暴晒'];

var AUTO_NOTE_PREFIX = '在线测肤';

// UTC 日历日加减（dateStr 为 YYYY-MM-DD）
function addDays(dateStr, delta) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// dateStr 是否在 [today-maxAgo, today] 内（含今天）
function withinDays(dateStr, todayStr, maxAgo) {
  if (!dateStr || dateStr > todayStr) return false;
  var d = Date.parse(dateStr + 'T00:00:00Z');
  var t = Date.parse(todayStr + 'T00:00:00Z');
  return (t - d) / 86400000 <= maxAgo;
}

// YYYY-MM-DD → "M月D日"
function fmtDateLabel(dateStr) {
  return parseInt(dateStr.slice(5, 7), 10) + '月' + parseInt(dateStr.slice(8, 10), 10) + '日';
}

Page({
  data: {
    notLoggedIn: false,
    loading: true,
    loadError: false,
    todayStr: '',
    minDate: '',
    summary: null,

    // 趋势
    trendsLoaded: false,
    trendsError: false,
    trendUnlocked: false,
    trendRange: 30,
    rangeOptions: [7, 30, 90],
    rangeEmpty: false,
    trendSummary: null,

    // 测肤记录
    tests: [],
    testsLoaded: false,
    testsError: false,
    testsTotal: 0,
    testsHasMore: false,

    // 日记/时间线
    entries: [],
    entriesHasMore: false,
    timeline: [],
    band: [],
    manualToday: null,
    loadingMore: false,
    confirmingDeleteId: '',

    // 打卡表单
    formOpen: false,
    formDate: '',
    formDateLabel: '',
    formState: 'good',
    formTags: [],
    formNote: '',
    formIsEdit: false,
    saving: false,
    stateOptions: [],
    skinTagList: [],
    situationTagList: [],
  },

  onLoad: function () {
    this._trendDays = [];
    this._loaded = false;
    this._submitting = false;
    this._deleting = false;
    var stateOptions = STATE_KEYS.map(function (key) {
      return { key: key, label: STATE_META[key].label, color: STATE_META[key].color };
    });
    this.setData({ stateOptions: stateOptions });
    this.refreshTagList([]);
  },

  onShow: function () {
    // "今天"快照：每次进入刷新（跨午夜口径与 H5 一致）
    var todayStr = util.clientDateStr(new Date());
    this.setData({
      todayStr: todayStr,
      minDate: addDays(todayStr, -BACKFILL_DAYS),
    });
    if (!auth.isLoggedIn()) {
      this.setData({ notLoggedIn: true, loading: false });
      return;
    }
    this.setData({ notLoggedIn: false });
    if (!this._loaded) {
      this._loaded = true;
      this.loadEntries();
      this.loadTrends();
      this.loadTests();
    }
  },

  onPullDownRefresh: function () {
    if (!auth.isLoggedIn()) {
      wx.stopPullDownRefresh();
      return;
    }
    var self = this;
    self._loaded = true;
    Promise.all([self.loadEntries(), self.loadTrends(), self.loadTests()]).then(
      function () { wx.stopPullDownRefresh(); },
      function () { wx.stopPullDownRefresh(); }
    );
  },

  // --------------------------------------------------------------------------
  // 数据加载
  // --------------------------------------------------------------------------

  loadEntries: function () {
    var self = this;
    self.setData({ loading: true, loadError: false });
    return request({
      base: 'advisory',
      url: '/api/user/diary?bootstrap=1&limit=' + ENTRIES_PAGE_SIZE,
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var list = (res && res.data) || [];
      self.setData({
        loading: false,
        entries: list,
        summary: (res && res.summary) || null,
        entriesHasMore: !!(res && res.pagination && res.pagination.hasMore),
      });
      self.buildViews();
    }).catch(function () {
      self.setData({ loading: false, loadError: true });
    });
  },

  // 打卡/删除后的轻量刷新：带回已加载数量（不多拉一页）
  reloadEntries: function () {
    var self = this;
    var limit = Math.max(ENTRIES_PAGE_SIZE, this.data.entries.length || 0);
    return request({
      base: 'advisory',
      url: '/api/user/diary?bootstrap=1&limit=' + limit,
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var list = (res && res.data) || [];
      self.setData({
        entries: list,
        summary: (res && res.summary) || self.data.summary,
        entriesHasMore: !!(res && res.pagination && res.pagination.hasMore),
      });
      self.buildViews();
    }).catch(function () {
      account.toast('列表刷新失败，请稍后再试');
    });
  },

  loadTrends: function () {
    var self = this;
    self.setData({ trendsLoaded: false, trendsError: false });
    return request({
      base: 'advisory',
      url: '/api/user/skin-trends',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var data = res && res.data;
      if (!data || !Array.isArray(data.dates) || !Array.isArray(data.scores) || data.dates.length < 2) {
        self._trendDays = [];
        self.setData({ trendsLoaded: true, trendUnlocked: false });
        return;
      }
      // 按本地日历日聚合（同日多次取最后一次），保留最近 90 天
      var byDay = {};
      for (var i = 0; i < data.dates.length; i++) {
        var iso = data.dates[i];
        var day = util.clientDateStr(new Date(iso));
        byDay[day] = { dateStr: day, iso: iso, score: data.scores[i] };
      }
      var days = Object.keys(byDay).sort().map(function (key) {
        return byDay[key];
      }).slice(-90);
      self._trendDays = days;
      if (days.length < 2) {
        self.setData({ trendsLoaded: true, trendUnlocked: false });
        return;
      }
      self.setData({ trendsLoaded: true, trendUnlocked: true });
      self.applyTrendRange();
    }).catch(function () {
      self.setData({ trendsLoaded: true, trendsError: true });
    });
  },

  loadTests: function () {
    var self = this;
    self.setData({ testsLoaded: false, testsError: false });
    return request({
      base: 'advisory',
      url: '/api/advisor/history?page=1&limit=' + TESTS_PAGE_SIZE + '&lite=1',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var list = (res && res.history) || [];
      var total = (res && res.pagination && res.pagination.total) || 0;
      self.setData({
        testsLoaded: true,
        tests: list,
        testsTotal: total,
        testsHasMore: list.length < total,
      });
      self.buildViews();
    }).catch(function () {
      self.setData({ testsLoaded: true, testsError: true });
    });
  },

  onRetryEntries: function () {
    this.loadEntries();
  },

  onRetryTrends: function () {
    this.loadTrends();
  },

  onRetryTests: function () {
    this.loadTests();
  },

  onLoadMore: function () {
    var self = this;
    if (this.data.loadingMore) return;
    if (this.data.testsHasMore) {
      var tests = this.data.tests;
      var cursor = tests.length ? tests[tests.length - 1].completedAt : '';
      if (!cursor) {
        this.setData({ testsHasMore: false });
        return;
      }
      this.setData({ loadingMore: true });
      request({
        base: 'advisory',
        url: '/api/advisor/history?limit=' + TESTS_PAGE_SIZE + '&lite=1&before=' + encodeURIComponent(cursor),
        method: 'GET',
        showError: false,
      }).then(function (res) {
        var more = (res && res.history) || [];
        // sessionId 去重兜底（游标为排他语义，正常不重叠；防未来口径变化产生重复 key）
        var seen = {};
        self.data.tests.forEach(function (t) { seen[t.sessionId] = true; });
        var unique = more.filter(function (t) { return !seen[t.sessionId]; });
        var merged = self.data.tests.concat(unique);
        var total = (res && res.pagination && res.pagination.total) || self.data.testsTotal;
        self.setData({
          loadingMore: false,
          tests: merged,
          testsTotal: total,
          testsHasMore: unique.length > 0 && merged.length < total,
        });
        self.buildViews();
      }).catch(function () {
        self.setData({ loadingMore: false });
        account.toast('加载失败，请稍后再试');
      });
      return;
    }
    if (this.data.entriesHasMore) {
      var entries = this.data.entries;
      var entryCursor = entries.length ? entries[entries.length - 1].date.slice(0, 10) : '';
      if (!entryCursor) {
        this.setData({ entriesHasMore: false });
        return;
      }
      this.setData({ loadingMore: true });
      request({
        base: 'advisory',
        url: '/api/user/diary?limit=' + ENTRIES_PAGE_SIZE + '&before=' + entryCursor,
        method: 'GET',
        showError: false,
      }).then(function (res) {
        var more = (res && res.data) || [];
        var seen = {};
        self.data.entries.forEach(function (e) { seen[e.id] = true; });
        var merged = self.data.entries.concat(more.filter(function (e) { return !seen[e.id]; }));
        self.setData({
          loadingMore: false,
          entries: merged,
          entriesHasMore: !!(res && res.pagination && res.pagination.hasMore),
        });
        self.buildViews();
      }).catch(function () {
        self.setData({ loadingMore: false });
        account.toast('加载失败，请稍后再试');
      });
    }
  },

  // --------------------------------------------------------------------------
  // 视图构建：时间线（打卡 + 测肤合并）+ 近30天色带
  // --------------------------------------------------------------------------

  isAutoEntry: function (entry) {
    return !!(entry && entry.note && entry.note.indexOf(AUTO_NOTE_PREFIX) === 0);
  },

  findManualEntry: function (dateStr) {
    var list = this.data.entries || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].date.slice(0, 10) === dateStr && !this.isAutoEntry(list[i])) return list[i];
    }
    return null;
  },

  buildViews: function () {
    var self = this;
    var todayStr = this.data.todayStr;

    // ---- 时间线：两类事件按日合并 ----
    var byDay = {};
    (this.data.entries || []).forEach(function (e) {
      var day = e.date.slice(0, 10);
      var auto = self.isAutoEntry(e);
      var meta = STATE_META[e.skinState] || STATE_META.normal;
      (byDay[day] = byDay[day] || []).push({
        key: 'd' + e.id,
        kind: 'diary',
        id: e.id,
        dateStr: day,
        auto: auto,
        skinState: e.skinState,
        stateLabel: meta.label,
        stateColor: meta.color,
        tags: Array.isArray(e.tags) ? e.tags : [],
        note: e.note || '',
        // 主站写入窗口 [today-90, today]：窗口外的历史记录只可删除、不可编辑
        canEdit: withinDays(day, todayStr, BACKFILL_DAYS),
      });
    });
    (this.data.tests || []).forEach(function (t) {
      var completedAt = t.completedAt || '';
      var date = new Date(completedAt);
      if (isNaN(date.getTime())) return;
      var day = util.clientDateStr(date);
      var ar = t.analysisResult || {};
      var score = ar.faceAnalysis && typeof ar.faceAnalysis.overallScore === 'number'
        ? Math.round(ar.faceAnalysis.overallScore) : null;
      (byDay[day] = byDay[day] || []).push({
        key: 't' + t.sessionId,
        kind: 'test',
        sessionId: t.sessionId,
        dateStr: day,
        score: score,
        typeLabel: (ar.skinProfile && ar.skinProfile.typeLabel) || '',
      });
    });

    var groups = Object.keys(byDay).sort().reverse().map(function (day) {
      var events = byDay[day];
      var hasTest = events.some(function (ev) { return ev.kind === 'test'; });
      // 同日已有测肤事件时隐藏自动日记（避免同一件事重复展示，与 H5 时间线口径一致）
      if (hasTest) {
        events = events.filter(function (ev) { return !(ev.kind === 'diary' && ev.auto); });
      }
      var hasManual = events.some(function (ev) { return ev.kind === 'diary' && !ev.auto; });
      return {
        dateStr: day,
        label: day === todayStr ? '今天' : fmtDateLabel(day),
        isToday: day === todayStr,
        hasManual: hasManual,
        canBackfill: !hasManual && withinDays(day, todayStr, BACKFILL_DAYS),
        events: events,
      };
    }).filter(function (g) { return g.events.length > 0; });

    // ---- 近 30 天打卡色带（含测肤自动记录的肌肤状态）----
    var entryByDate = {};
    (this.data.entries || []).forEach(function (e) {
      entryByDate[e.date.slice(0, 10)] = e;
    });
    var band = [];
    for (var i = 29; i >= 0; i--) {
      var date = addDays(todayStr, -i);
      var entry = entryByDate[date];
      var meta = entry ? (STATE_META[entry.skinState] || STATE_META.normal) : null;
      band.push({
        date: date,
        color: meta ? meta.color : '#ece6da',
        has: !!meta,
        isToday: i === 0,
      });
    }

    // ---- 今日手动打卡状态（自动记录不算打卡）----
    var manualToday = this.findManualEntry(todayStr);

    this.setData({
      timeline: groups,
      band: band,
      manualToday: manualToday
        ? { dateStr: todayStr, stateLabel: (STATE_META[manualToday.skinState] || STATE_META.normal).label }
        : null,
    });
  },

  // --------------------------------------------------------------------------
  // 趋势图
  // --------------------------------------------------------------------------

  onTrendRange: function (e) {
    var range = Number(e.currentTarget.dataset.range);
    if (range !== 7 && range !== 30 && range !== 90) return;
    this.setData({ trendRange: range });
    this.applyTrendRange();
  },

  applyTrendRange: function () {
    var self = this;
    var days = this._trendDays || [];
    if (days.length < 2) return;
    var todayStr = this.data.todayStr;
    var range = this.data.trendRange;
    var cutoff = addDays(todayStr, -(range - 1));
    var win = days.filter(function (d) { return d.dateStr >= cutoff; });
    if (win.length < 2) {
      self.setData({ rangeEmpty: true, trendSummary: null });
      return;
    }
    var latest = Math.round(win[win.length - 1].score);
    var delta = Math.round((win[win.length - 1].score - win[0].score) * 10) / 10;
    // setData 回调中再查询 canvas：保证条件渲染的 canvas 节点已完成挂载
    self.setData({
      rangeEmpty: false,
      trendSummary: {
        latest: latest,
        deltaText: delta > 0 ? '较起点 +' + delta : delta < 0 ? '较起点 ' + delta : '较起点持平',
        deltaUp: delta > 0,
        deltaDown: delta < 0,
      },
    }, function () {
      self.drawTrendCanvas(win);
    });
  },

  drawTrendCanvas: function (win) {
    wx.createSelectorQuery().in(this)
      .select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        var node = res && res[0] && res[0].node;
        if (!node) return;
        var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        trend.drawTrend(
          node,
          res[0].width,
          res[0].height,
          info.pixelRatio || 2,
          win.map(function (d) { return d.iso; }),
          win.map(function (d) { return d.score; })
        );
      });
  },

  // --------------------------------------------------------------------------
  // 打卡表单（新建 / 编辑 / 补打卡）
  // --------------------------------------------------------------------------

  refreshTagList: function (selected) {
    var tags = selected || this.data.formTags || [];
    function build(list) {
      return list.map(function (label) {
        return { label: label, selected: tags.indexOf(label) > -1 };
      });
    }
    this.setData({
      skinTagList: build(SKIN_TAGS),
      situationTagList: build(SITUATION_TAGS),
    });
  },

  openCheckIn: function (e) {
    var dateStr = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.date) || this.data.todayStr;
    dateStr = dateStr.slice(0, 10);
    if (!withinDays(dateStr, this.data.todayStr, BACKFILL_DAYS)) dateStr = this.data.todayStr;
    var existing = this.findManualEntry(dateStr);
    this.applyFormForDate(dateStr, existing);
    this.setData({ formOpen: true });
  },

  applyFormForDate: function (dateStr, existing) {
    var tags = existing && Array.isArray(existing.tags) ? existing.tags.slice(0, MAX_TAGS) : [];
    this.setData({
      formDate: dateStr,
      formDateLabel: dateStr === this.data.todayStr ? '今天' : fmtDateLabel(dateStr),
      formState: existing && STATE_META[existing.skinState] ? existing.skinState : 'good',
      formTags: tags,
      formNote: existing ? (existing.note || '') : '',
      formIsEdit: !!existing,
    });
    this.refreshTagList(tags);
  },

  onFormClose: function () {
    if (this.data.saving) return;
    this.setData({ formOpen: false });
  },

  noop: function () {},

  onFormDateChange: function (e) {
    var dateStr = e.detail.value;
    var existing = this.findManualEntry(dateStr);
    this.applyFormForDate(dateStr, existing);
  },

  onFormState: function (e) {
    var key = e.currentTarget.dataset.key;
    if (STATE_META[key]) this.setData({ formState: key });
  },

  onFormTag: function (e) {
    var label = e.currentTarget.dataset.label;
    var tags = this.data.formTags.slice();
    var idx = tags.indexOf(label);
    if (idx > -1) {
      tags.splice(idx, 1);
    } else {
      if (tags.length >= MAX_TAGS) {
        account.toast('最多选择 ' + MAX_TAGS + ' 个标签');
        return;
      }
      tags.push(label);
    }
    this.setData({ formTags: tags });
    this.refreshTagList(tags);
  },

  onFormNote: function (e) {
    this.setData({ formNote: e.detail.value || '' });
  },

  onFormSave: function () {
    var self = this;
    if (this._submitting) return;
    if (!STATE_META[this.data.formState]) {
      account.toast('请选择肌肤状态');
      return;
    }
    this._submitting = true;
    this.setData({ saving: true });
    request({
      base: 'advisory',
      url: '/api/user/diary',
      method: 'POST',
      data: {
        date: this.data.formDate,
        skinState: this.data.formState,
        tags: this.data.formTags,
        note: (this.data.formNote || '').trim(),
      },
      showError: false,
    }).then(function (res) {
      self._submitting = false;
      self.setData({ saving: false, formOpen: false });
      var granted = res && res.points && res.points.granted;
      wx.showToast({
        title: granted ? '打卡成功 +' + granted + ' 积分' : (self.data.formIsEdit ? '已保存' : '打卡成功'),
        icon: 'none',
      });
      self.reloadEntries();
    }).catch(function (err) {
      self._submitting = false;
      self.setData({ saving: false });
      account.toast((err && err.message) || '保存失败，请稍后再试');
    });
  },

  onFormDelete: function () {
    var self = this;
    wx.showModal({
      title: '删除打卡记录',
      content: '删除这天的打卡记录？',
      confirmText: '删除',
      confirmColor: '#b4553f',
      success: function (res) {
        if (!res.confirm || self._submitting) return;
        self._submitting = true;
        self.setData({ saving: true });
        request({
          base: 'advisory',
          url: '/api/user/diary?date=' + self.data.formDate,
          method: 'DELETE',
          showError: false,
        }).then(function () {
          self._submitting = false;
          self.setData({ saving: false, formOpen: false });
          wx.showToast({ title: '记录已删除', icon: 'none' });
          self.reloadEntries();
        }).catch(function () {
          self._submitting = false;
          self.setData({ saving: false });
          account.toast('删除未成功，请稍后再试');
        });
      },
    });
  },

  // --------------------------------------------------------------------------
  // 时间线操作
  // --------------------------------------------------------------------------

  onDeleteTap: function (e) {
    this.setData({ confirmingDeleteId: e.currentTarget.dataset.id || '' });
  },

  onCancelDelete: function () {
    this.setData({ confirmingDeleteId: '' });
  },

  onDeleteEntry: function (e) {
    var self = this;
    var dateStr = e.currentTarget.dataset.date;
    if (this._deleting || !dateStr) return;
    this._deleting = true;
    request({
      base: 'advisory',
      url: '/api/user/diary?date=' + dateStr,
      method: 'DELETE',
      showError: false,
    }).then(function () {
      self._deleting = false;
      self.setData({ confirmingDeleteId: '' });
      wx.showToast({ title: '记录已删除', icon: 'none' });
      self.reloadEntries();
    }).catch(function () {
      self._deleting = false;
      account.toast('删除未成功，请稍后再试');
    });
  },

  onOpenTest: function (e) {
    var sessionId = e.currentTarget.dataset.session;
    if (!sessionId) return;
    wx.navigateTo({ url: '/pages/result/result?sessionId=' + sessionId });
  },

  onGoHistory: function () {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onGoLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },
});
