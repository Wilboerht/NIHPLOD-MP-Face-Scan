var config = require('../../config.js');
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
    if (isFirst) self._lastCompletedAt = '';
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
          typeLabel: v.skinTypeLabel || legacyType,
          topFinding: v.topFinding && v.topFinding.title ? v.topFinding.title : '',
        };
      });

      var merged = isFirst ? items : self.data.list.concat(items);
      var seen = {};
      merged = merged.filter(function (item) {
        if (!item.sessionId || seen[item.sessionId]) return false;
        seen[item.sessionId] = true;
        return true;
      });
      if (items.length > 0) self._lastCompletedAt = items[items.length - 1].completedAt;
      var pagination = res.pagination || {};
      self.setData({
        loading: false,
        loadingMore: false,
        loadError: '',
        list: merged,
        page: isFirst ? 1 : self.data.page + 1,
        totalPages: pagination.totalPages || self.data.totalPages,
        hasMore: items.length >= PAGE_SIZE,
      });
    }).catch(function (err) {
      self.setData({
        loading: false,
        loadingMore: false,
        loadError: isFirst && !silent ? (err.message || '加载失败，请重试') : self.data.loadError,
      });
    });
  },

  onLoadMore: function () {
    if (this.data.loadingMore || !this.data.hasMore || !this._lastCompletedAt) return;
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
