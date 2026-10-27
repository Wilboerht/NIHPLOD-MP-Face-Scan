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

  // 将微信平台隐私授权同步到测肤子站（服务端 analyze/face-analyze 强校验）
  syncPrivacyConsent: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt || agreed.version !== config.PRIVACY_VERSION) {
      return Promise.resolve(false);
    }

    var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
    if (!token) return Promise.resolve(false);

    var request = require('./utils/request.js').request;
    return request({
      base: 'advisory',
      url: '/api/account/consent',
      method: 'POST',
      showError: false,
      data: {
        agreed: true,
        version: config.PRIVACY_VERSION,
        scopes: ['privacy', 'face', 'health', 'ai'],
      },
    }).then(function () {
      return true;
    }).catch(function () {
      return false;
    });
  },
});
