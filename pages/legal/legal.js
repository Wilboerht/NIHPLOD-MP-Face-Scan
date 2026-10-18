var LEGAL_DOCS = require('../../utils/legal-text.js');

Page({
  data: {
    doc: LEGAL_DOCS.privacy,
  },

  onLoad: function (query) {
    var type = query && query.type === 'terms' ? 'terms' : 'privacy';
    var doc = LEGAL_DOCS[type];
    wx.setNavigationBarTitle({ title: doc.title });
    this.setData({ doc: doc });
  },
});
