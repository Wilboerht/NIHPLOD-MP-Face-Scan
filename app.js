var config = require('./config.js');

App({
  globalData: {},

  // 记录隐私授权同意（用于 analyze 请求的 privacyConsent 审计载荷）。
  // 实际授权由微信官方隐私弹窗完成（见 pages/index 的 wx.requirePrivacyAuthorize）。
  recordPrivacyConsent: function () {
    var current = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (current && current.consentedAt && current.version === config.PRIVACY_VERSION) {
      return;
    }
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: config.PRIVACY_VERSION,
      consentedAt: new Date().toISOString(),
    });
  },

  // 读取 analyze 请求需要的 privacyConsent 载荷（H5 AnalyzeRequestSchema 同名字段）
  getPrivacyConsentPayload: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt) return null;
    return { version: agreed.version || config.PRIVACY_VERSION, consentedAt: agreed.consentedAt };
  },
});
