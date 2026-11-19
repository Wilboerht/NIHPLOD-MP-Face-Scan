var LEGAL_DOCS = require('../../utils/legal-text.js');

Page({
  data: {
    doc: LEGAL_DOCS.privacy,
    fullUrl: 'https://nihplod.cn/privacy',
  },

  onLoad: function (query) {
    var type = query && query.type === 'terms' ? 'terms' : 'privacy';
    var doc = LEGAL_DOCS[type];
    wx.setNavigationBarTitle({ title: doc.title });
    this.setData({
      doc: doc,
      fullUrl: type === 'terms' ? 'https://nihplod.cn/terms' : 'https://nihplod.cn/privacy',
    });
  },

  copyFullUrl: function () {
    wx.setClipboardData({
      data: this.data.fullUrl,
      success: function () {
        wx.showToast({ title: '链接已复制', icon: 'none' });
      },
    });
  },
});
