var auth = require('../../utils/auth.js');
var subscribe = require('../../utils/subscribe.js');

Page({
  data: {
    showPrivacy: false,
    isLoggedIn: false,
    user: null,
    statusBarHeight: 20, // 自绘导航栏顶部占位（onLoad 按机型更新）
  },

  onLoad: function () {
    // index.json 为 navigationStyle: custom：取状态栏高度做导航栏占位
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: (info && info.statusBarHeight) || 20 });
  },

  onShow: function () {
    var self = this;
    // 每次回到首页都确认一次隐私授权状态（用户可能在设置页改过）
    getApp().checkPrivacy(function (need) {
      self.setData({ showPrivacy: need });
    });
    this.setData({
      isLoggedIn: auth.isLoggedIn(),
      user: auth.getUser(),
    });
  },

  onAgreePrivacy: function () {
    getApp().onPrivacyAgreed();
    this.setData({ showPrivacy: false });
  },

  onDisagreePrivacy: function () {
    wx.showToast({ title: '同意隐私协议后才能使用测肤服务', icon: 'none' });
  },

  onStart: function () {
    if (this.data.showPrivacy) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' });
      return;
    }
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    // 订阅「报告完成通知」（接近分析流程起点，且处于用户点击调用栈内；
    // 未配置模板 / 用户拒绝均不阻断，分析完成后由服务端推送）
    subscribe.requestSubscription(function () {
      wx.navigateTo({ url: '/pages/questionnaire/questionnaire' });
    });
  },

  onGoHistory: function () {
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onGoArchive: function () {
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/archive/archive' });
  },

  onEditProfile: function () {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onLogout: function () {
    var self = this;
    wx.showModal({
      title: '退出登录',
      content: '退出后本地登录态将被清除，历史报告仍保留在账号中。',
      confirmText: '退出',
      confirmColor: '#b4553f',
      success: function (res) {
        if (!res.confirm) return;
        auth.logout();
        self.setData({ isLoggedIn: false, user: null });
        wx.showToast({ title: '已退出登录', icon: 'none' });
      },
    });
  },
});
