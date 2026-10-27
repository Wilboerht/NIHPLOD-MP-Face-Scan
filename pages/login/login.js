var config = require('../../config.js');
var auth = require('../../utils/auth.js');

var PENDING_ROUTE_TTL_MS = 10 * 60 * 1000;

// 读取并清理登录前暂存的受保护页面（如报告深链），生成 reLaunch URL
function consumePendingRoute() {
  var pending = null;
  try {
    pending = wx.getStorageSync(config.STORAGE_KEYS.PENDING_ROUTE);
    wx.removeStorageSync(config.STORAGE_KEYS.PENDING_ROUTE);
  } catch (e) {}
  if (!pending || !pending.route || pending.route === 'pages/login/login') return '';
  if (!pending.at || Date.now() - pending.at > PENDING_ROUTE_TTL_MS) return '';

  var options = pending.options || {};
  var parts = [];
  Object.keys(options).forEach(function (key) {
    var value = options[key];
    if (value === undefined || value === null || value === '') return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return '/' + pending.route + (parts.length ? '?' + parts.join('&') : '');
}

// 登录成功后的统一收尾：优先回到登录前页面，否则返回上一页/首页
function finishLogin() {
  function navigate() {
    var pendingUrl = consumePendingRoute();
    if (pendingUrl) {
      wx.reLaunch({ url: pendingUrl });
      return;
    }
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  }
  var app = getApp();
  if (app && app.syncPrivacyConsent) {
    app.syncPrivacyConsent().then(navigate, navigate);
    return;
  }
  navigate();
}

Page({
  data: {
    loading: false,
    needBinding: false,
  },

  onLogin: function () {
    var self = this;
    if (self.data.loading) return;
    self.setData({ loading: true });
    wx.showLoading({ title: '登录中…', mask: true });

    function done() {
      wx.hideLoading();
      self.setData({ loading: false });
    }

    auth.login().then(function (data) {
      done();
      if (data.needBinding) {
        // 新用户：切换到手机号一键绑定 UI（免短信，getPhoneNumber 直验）
        self.setData({ needBinding: true });
        return;
      }
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(finishLogin, 800);
    }).catch(function (err) {
      done();
      wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' });
    });
  },

  onSkip: function () {
    try { wx.removeStorageSync(config.STORAGE_KEYS.PENDING_ROUTE); } catch (e) {}
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onOpenPrivacy: function () {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        fail: function () {
          wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
        },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
  },

  onOpenTerms: function () {
    wx.navigateTo({ url: '/pages/legal/legal?type=terms' });
  },

  // 手机号一键绑定（getPhoneNumber 按钮回调）
  onGetPhoneNumber: function (e) {
    var self = this;
    var code = e && e.detail && e.detail.code;
    if (!code) {
      // 用户拒绝授权：停留在当前页，可重新点击
      if (e && e.detail && e.detail.errMsg && e.detail.errMsg.indexOf('cancel') === -1) {
        wx.showToast({ title: '未获得手机号授权', icon: 'none' });
      }
      return;
    }
    if (self.data.loading) return;
    self.setData({ loading: true });
    wx.showLoading({ title: '绑定中…', mask: true });

    auth.bindPhoneAndLogin(code).then(function () {
      wx.hideLoading();
      self.setData({ loading: false });
      wx.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(finishLogin, 800);
    }).catch(function (err) {
      wx.hideLoading();
      self.setData({ loading: false });
      wx.showToast({ title: (err && err.message) || '绑定失败，请重试', icon: 'none' });
    });
  },
});
