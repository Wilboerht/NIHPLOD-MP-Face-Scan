var config = require('./config.js');

App({
  globalData: {
    privacyNeedAuth: false,
  },

  onLaunch: function () {
    // 启动时检查隐私协议授权状态；具体弹窗由首页渲染（见 pages/index）
    this.checkPrivacy(function () {});
  },

  /**
   * 隐私协议检查
   * 规则：本地未同意过，且（微信侧要求授权 OR 本地标记缺失）→ 需要弹自定义弹窗
   * cb(needAuth: boolean)
   */
  checkPrivacy: function (cb) {
    var self = this;
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (agreed) {
      self.globalData.privacyNeedAuth = false;
      if (cb) cb(false);
      return;
    }
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: function (res) {
          var need = !!res.needAuthorization || !agreed;
          self.globalData.privacyNeedAuth = need;
          if (cb) cb(need);
        },
        fail: function () {
          // 查询失败保守处理：本地未同意过就弹
          self.globalData.privacyNeedAuth = true;
          if (cb) cb(true);
        },
      });
    } else {
      // 低版本基础库无 wx.getPrivacySetting，按本地标记处理
      self.globalData.privacyNeedAuth = true;
      if (cb) cb(true);
    }
  },

  // 用户同意隐私协议：存本地标记，并同步微信侧授权
  onPrivacyAgreed: function () {
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: config.PRIVACY_VERSION,
      consentedAt: new Date().toISOString(),
    });
    this.globalData.privacyNeedAuth = false;
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ fail: function () {} });
    }
  },

  // 读取 analyze 请求需要的 privacyConsent 载荷（H5 AnalyzeRequestSchema 同名字段）
  getPrivacyConsentPayload: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt) return null;
    return { version: agreed.version || config.PRIVACY_VERSION, consentedAt: agreed.consentedAt };
  },
});
