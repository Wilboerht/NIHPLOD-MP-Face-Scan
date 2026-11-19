var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');
var subscribe = require('../../utils/subscribe.js');

var PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    loadError: '',
    notLoggedIn: false,
    list: [],
    page: 1,
    totalPages: 1,
    hasMore: true,
    loadingMore: false,
    skeletonRows: [1, 2, 3],
  },

  onLoad: function () {
    this._loaded = false;
    this._fetchSeq = 0;
    this._refreshing = false;
  },

  onShow: function () {
    if (!auth.isLoggedIn()) {
      this._loaded = false;
      this.setData({ loading: false, notLoggedIn: true, list: [] });
      return;
    }
    this.setData({ notLoggedIn: false });
    if (this._loaded) {
      if (this._needsRefresh) {
        this._needsRefresh = false;
        this.fetchHistory(1, { silent: this.data.list.length > 0 });
      }
      return;
    }
    this._loaded = true;
    this.fetchHistory(1);
  },

  onHide: function () {
    if (this._loaded) this._needsRefresh = true;
  },

  // GET /api/advisor/history?limit=&lite=1&view=1[&before=]
  // 追加加载用 completedAt 游标，避免 offset 分页在新增/归档时重复或漏记录
  fetchHistory: function (page, options) {
    var self = this;
    var isFirst = page === 1;
    var silent = !!(options && options.silent);
    var seq = ++self._fetchSeq;
    if (isFirst) self._refreshing = silent;
    if (isFirst && !silent) self.setData({ loading: true, loadError: '' });
    else if (!isFirst) self.setData({ loadingMore: true });

    var url = '/api/advisor/history?page=' + page + '&limit=' + PAGE_SIZE + '&lite=1&view=1';
    if (!isFirst && self._lastCompletedAt) {
      url += '&before=' + encodeURIComponent(self._lastCompletedAt);
    }

    return request({
      base: 'advisory',
      url: url,
      method: 'GET',
      showError: false,
    }).then(function (res) {
      if (seq !== self._fetchSeq) return;
      var items = (res.history || []).map(function (s) {
        var v = s.view || {};
        var ar = s.analysisResult || {};
        var legacyScore = ar.faceAnalysis && typeof ar.faceAnalysis.overallScore === 'number'
          ? Math.round(ar.faceAnalysis.overallScore) : null;
        var legacyType = (ar.skinProfile && ar.skinProfile.typeLabel)
          || (ar.skinAnalysis && ar.skinAnalysis.typeLabel)
          || (ar.skinType && ar.skinType.typeLabel)
          || '';
        return {
          sessionId: s.sessionId,
          completedAt: s.completedAt,
          timeText: util.formatTime(s.completedAt),
          score: typeof v.overallScore === 'number' ? Math.round(v.overallScore) : legacyScore,
          typeLabel: util.plainText(v.skinTypeLabel || legacyType),
          topFinding: util.plainText(v.topFinding && v.topFinding.title ? v.topFinding.title : ''),
        };
      });

      var pagination = res.pagination || {};
      var total = typeof pagination.total === 'number' ? pagination.total : null;
      var merged;
      if (isFirst) {
        if (silent && !(items.length === 0 && total === 0)) {
          // 静默刷新保留已加载的更早分页，避免从详情页返回后列表被重置
          var freshIds = {};
          items.forEach(function (item) { freshIds[item.sessionId] = true; });
          var older = self.data.list.filter(function (item) {
            return !freshIds[item.sessionId];
          });
          merged = items.concat(older);
        } else {
          merged = items;
        }
      } else {
        merged = self.data.list.concat(items);
      }
      var seen = {};
      merged = merged.filter(function (item) {
        if (!item.sessionId || seen[item.sessionId]) return false;
        seen[item.sessionId] = true;
        return true;
      });
      if (isFirst && silent) {
        merged.sort(function (a, b) {
          return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
        });
      }
      self._lastCompletedAt = merged.length
        ? (merged[merged.length - 1].completedAt || '')
        : '';
      self._refreshing = false;
      self.setData({
        loading: false,
        loadingMore: false,
        loadError: '',
        list: merged,
        page: isFirst ? (silent ? Math.max(1, self.data.page) : 1) : self.data.page + 1,
        totalPages: pagination.totalPages || self.data.totalPages,
        hasMore: total !== null ? merged.length < total : items.length >= PAGE_SIZE,
      });
    }).catch(function (err) {
      if (seq !== self._fetchSeq) return;
      self._refreshing = false;
      self.setData({
        loading: false,
        loadingMore: false,
        loadError: isFirst && !silent ? (err.message || '加载失败，请重试') : self.data.loadError,
      });
    });
  },

  onLoadMore: function () {
    if (this.data.loading || this.data.loadingMore || this._refreshing) return;
    if (!this.data.hasMore || !this._lastCompletedAt) return;
    this.fetchHistory(this.data.page + 1);
  },

  onReachBottom: function () {
    this.onLoadMore();
  },

  onPullDownRefresh: function () {
    if (!auth.isLoggedIn()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.fetchHistory(1, { silent: this.data.list.length > 0 }).then(function () {
      wx.stopPullDownRefresh();
    }, function () {
      wx.stopPullDownRefresh();
    });
  },

  onItemTap: function (e) {
    var sessionId = e.currentTarget.dataset.sessionId;
    wx.navigateTo({ url: '/pages/result/result?sessionId=' + sessionId });
  },

  onGoLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onGoQuestionnaire: function () {
    if (!getApp().hasPrivacyConsentForCurrentUser || !getApp().hasPrivacyConsentForCurrentUser()) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    subscribe.requestSubscription(function () {
      wx.navigateTo({ url: '/pages/questionnaire/questionnaire' });
    });
  },

  onRetry: function () {
    this.fetchHistory(1);
  },
});
