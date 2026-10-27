var config = require('../../config.js');
var auth = require('../../utils/auth.js');
var subscribe = require('../../utils/subscribe.js');

Page({
  data: {
    isLoggedIn: false,
    user: null,
    statusBarHeight: 20, // 自定义导航栏状态栏高度占位，onLoad 时更新
    privacyReady: false,
    privacyChecking: true,
  },

  onLoad: function () {
    // index.json 为 navigationStyle: custom：取状态栏高度做导航栏占位
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: (info && info.statusBarHeight) || 20 });
  },

  onShow: function () {
    this.setData({
      isLoggedIn: auth.isLoggedIn(),
      user: auth.getUser(),
    });
    // 隐私授权前置到页面展示阶段：同意后再点「开始测肤」，
    // 订阅消息 requestSubscribeMessage 才能留在用户点击调用栈内
    this.ensurePrivacy();
  },

  ensurePrivacy: function () {
    var self = this;
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (agreed && agreed.consentedAt && agreed.version === config.PRIVACY_VERSION) {
      self.setData({ privacyReady: true, privacyChecking: false });
      return;
    }
    if (!wx.requirePrivacyAuthorize) {
      // 低版本基础库：以页面「开始测肤即表示同意」的明示文案为准
      self.setData({ privacyReady: true, privacyChecking: false });
      return;
    }
    // 每次进入页面只自动弹一次；用户拒绝后由内联提示的「去同意」按钮再次触发
    if (self._privacyPrompted) {
      self.setData({ privacyChecking: false });
      return;
    }
    self._privacyPrompted = true;
    self._privacyPrompting = true;
    wx.requirePrivacyAuthorize({
      success: function () {
        getApp().recordPrivacyConsent();
        getApp().syncPrivacyConsent();
        self._privacyPrompting = false;
        self.setData({ privacyReady: true, privacyChecking: false });
      },
      fail: function () {
        self._privacyPrompting = false;
        self.setData({ privacyReady: false, privacyChecking: false });
      },
    });
  },

  // 用户主动点击「去同意」/未授权时点「开始测肤」：在用户点击栈内触发官方隐私弹窗
  onAgreePrivacy: function () {
    var self = this;
    if (!wx.requirePrivacyAuthorize) {
      getApp().recordPrivacyConsent();
      getApp().syncPrivacyConsent();
      self.setData({ privacyReady: true, privacyChecking: false });
      return;
    }
    if (self._privacyPrompting) return;
    self._privacyPrompting = true;
    wx.requirePrivacyAuthorize({
      success: function () {
        getApp().recordPrivacyConsent();
        getApp().syncPrivacyConsent();
        self._privacyPrompting = false;
        self.setData({ privacyReady: true, privacyChecking: false });
        wx.showToast({ title: '已同意隐私政策，请再次点击开始测肤', icon: 'none', duration: 2500 });
      },
      fail: function () {
        self._privacyPrompting = false;
        self.setData({ privacyReady: false, privacyChecking: false });
        wx.showToast({ title: '同意隐私政策后才能开始测肤', icon: 'none' });
      },
    });
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

  onStart: function () {
    if (!this.data.privacyReady) {
      this.onAgreePrivacy();
      return;
    }
    // 低版本基础库没有官方隐私授权 API：以「开始测肤即表示同意」的明示文案记录同意
    if (!wx.requirePrivacyAuthorize) {
      getApp().recordPrivacyConsent();
      getApp().syncPrivacyConsent();
    }
    if (!auth.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    // 隐私授权已在页面展示阶段完成，这里的订阅请求处于用户点击调用栈内
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

  onGoPointsMall: function () {
    var points = config.POINTS_MP || {};
    if (!points.appid) return;
    wx.navigateToMiniProgram({
      appId: points.appid,
      path: points.path || undefined,
      fail: function () {
        wx.showToast({ title: '打开积分商城失败，请稍后重试', icon: 'none' });
      },
    });
  },

  onEditProfile: function () {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onShareAppMessage: function () {
    return {
      title: '肌智派 AI 测肤 · 一张照片读懂你的肌肤',
      path: '/pages/index/index',
    };
  },

  onShareTimeline: function () {
    return {
      title: '肌智派 AI 测肤 · 一张照片读懂你的肌肤',
    };
  },
});
