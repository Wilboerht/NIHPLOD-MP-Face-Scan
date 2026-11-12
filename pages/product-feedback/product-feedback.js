var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');
var analytics = require('../../utils/analytics.js');

var SKIN_FEEL_OPTIONS = [
  { value: 'light', label: '清爽' },
  { value: 'moist', label: '滋润' },
  { value: 'sticky', label: '略黏' },
  { value: 'irritating', label: '有刺激' },
];
var EFFECT_OPTIONS = [
  { value: 'improved', label: '改善明显' },
  { value: 'slight', label: '略有改善' },
  { value: 'none', label: '没有变化' },
  { value: 'worse', label: '变差' },
];

Page({
  data: {
    loading: true,
    loadError: '',
    items: [],
    formOpen: false,
    selected: null,
    rating: 0,
    ratingStars: [1, 2, 3, 4, 5],
    skinFeelOptions: SKIN_FEEL_OPTIONS,
    effectOptions: EFFECT_OPTIONS,
    skinFeel: '',
    effect: '',
    repurchase: null,
    note: '',
    submitting: false,
  },

  onLoad: function () {
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    this.loadPending();
  },

  loadPending: function () {
    var self = this;
    self.setData({ loading: true, loadError: '' });
    request({
      base: 'advisory',
      url: '/api/user/product-feedback/pending',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var items = (res && res.items) || [];
      self.setData({
        loading: false,
        items: items.map(function (item) {
          return Object.assign({}, item, {
            key: item.sessionId + '-' + item.productId,
            imageUrl: item.image ? util.absUrl(item.image) : '',
          });
        }),
      });
    }).catch(function (err) {
      self.setData({ loading: false, loadError: err.message || '加载失败，请重试' });
    });
  },

  openForm: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var item = this.data.items[index];
    if (!item) return;
    this.setData({
      formOpen: true,
      selected: item,
      rating: 0,
      skinFeel: '',
      effect: '',
      repurchase: null,
      note: '',
    });
  },

  closeForm: function () {
    if (this.data.submitting) return;
    this.setData({ formOpen: false, selected: null });
  },

  onRating: function (e) {
    this.setData({ rating: Number(e.currentTarget.dataset.value) || 0 });
  },

  onSkinFeel: function (e) {
    var value = e.currentTarget.dataset.value;
    this.setData({ skinFeel: this.data.skinFeel === value ? '' : value });
  },

  onEffect: function (e) {
    var value = e.currentTarget.dataset.value;
    this.setData({ effect: this.data.effect === value ? '' : value });
  },

  onRepurchase: function (e) {
    this.setData({ repurchase: e.currentTarget.dataset.value === 'yes' });
  },

  onNote: function (e) {
    this.setData({ note: e.detail.value || '' });
  },

  submit: function () {
    var self = this;
    var selected = self.data.selected;
    if (!selected || self.data.submitting) return;
    if (self.data.rating < 1) {
      wx.showToast({ title: '请先给产品打分', icon: 'none' });
      return;
    }
    self.setData({ submitting: true });
    request({
      base: 'advisory',
      url: '/api/user/product-feedback',
      method: 'POST',
      showError: false,
      data: {
        productId: selected.productId,
        sessionId: selected.sessionId,
        rating: self.data.rating,
        skinFeel: self.data.skinFeel || null,
        effect: self.data.effect || null,
        repurchase: typeof self.data.repurchase === 'boolean' ? self.data.repurchase : null,
        note: self.data.note || null,
      },
    }).then(function () {
      var items = self.data.items.filter(function (item) {
        return !(item.productId === selected.productId && item.sessionId === selected.sessionId);
      });
      analytics.track('feedback_submit', {
        targetType: 'product',
        productId: selected.productId,
        rating: self.data.rating,
      }, selected.sessionId);
      self.setData({ items: items, submitting: false, formOpen: false, selected: null });
      wx.showToast({ title: '感谢反馈', icon: 'success' });
    }).catch(function (err) {
      self.setData({ submitting: false });
      wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none' });
    });
  },

  onBack: function () {
    wx.navigateBack();
  },
});
