var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');

var PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    loadError: '',
    notLoggedIn: false,
    list: [],
    page: 1,
    totalPages: 1,
    loadingMore: false,
  },

  onShow: function () {
    if (!auth.isLoggedIn()) {
      this.setData({ loading: false, notLoggedIn: true, list: [] });
      return;
    }
    this.setData({ notLoggedIn: false });
    this.fetchHistory(1);
  },

  // GET /api/advisor/history?page=&limit=&lite=1
  // 响应 { history: [{sessionId, completedAt, analysisResult: {faceAnalysis?, skinProfile?, persona?}}], pagination: {page, limit, total, totalPages} }
  fetchHistory: function (page) {
    var self = this;
    var isFirst = page === 1;
    if (isFirst) self.setData({ loading: true, loadError: '' });
    else self.setData({ loadingMore: true });

    request({
      base: 'advisory',
      url: '/api/advisor/history?page=' + page + '&limit=' + PAGE_SIZE + '&lite=1',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var items = (res.history || []).map(function (s) {
        var ar = s.analysisResult || {};
        return {
          sessionId: s.sessionId,
          timeText: util.formatTime(s.completedAt),
          score: ar.faceAnalysis && typeof ar.faceAnalysis.overallScore === 'number'
            ? Math.round(ar.faceAnalysis.overallScore) : null,
          typeLabel: (ar.skinProfile && ar.skinProfile.typeLabel) || '',
        };
      });
      var pagination = res.pagination || { page: page, totalPages: page };
      self.setData({
        loading: false,
        loadingMore: false,
        list: isFirst ? items : self.data.list.concat(items),
        page: pagination.page,
        totalPages: pagination.totalPages || 1,
      });
    }).catch(function (err) {
      self.setData({
        loading: false,
        loadingMore: false,
        loadError: isFirst ? (err.message || '加载失败，请重试') : '',
      });
    });
  },

  onLoadMore: function () {
    if (this.data.loadingMore || this.data.page >= this.data.totalPages) return;
    this.fetchHistory(this.data.page + 1);
  },

  onItemTap: function (e) {
    var sessionId = e.currentTarget.dataset.sessionId;
    wx.navigateTo({ url: '/pages/result/result?sessionId=' + sessionId });
  },

  onGoLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onRetry: function () {
    this.fetchHistory(1);
  },
});
