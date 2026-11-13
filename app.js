var config = require('./config.js');

var lastConsentError = null;

App({
  globalData: {},

  // 记录隐私授权同意（用于 analyze 请求的 privacyConsent 审计载荷）。
  // 实际授权由微信官方隐私弹窗完成（见 pages/index 的 wx.requirePrivacyAuthorize）。
  currentUserId: function () {
    var user = wx.getStorageSync(config.STORAGE_KEYS.USER_INFO) || {};
    return user && user.id ? String(user.id) : '';
  },

  recordPrivacyConsent: function () {
    var current = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    if (current && current.consentedAt && current.version === config.PRIVACY_VERSION &&
        String(current.userId || '') === ownerId) {
      return;
    }
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: config.PRIVACY_VERSION,
      consentedAt: new Date().toISOString(),
      userId: ownerId,
      scopes: ['privacy', 'face', 'health', 'ai'],
    });
  },

  // 读取 analyze 请求需要的 privacyConsent 载荷（H5 AnalyzeRequestSchema 同名字段）
  getPrivacyConsentPayload: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt) return null;
    if (String(agreed.userId || '') !== this.currentUserId()) return null;
    return { version: agreed.version || config.PRIVACY_VERSION, consentedAt: agreed.consentedAt };
  },

  // 登录成功后，把登录前在设备上给出的同版本同意记录绑定到当前账号；
  // 不存在旧的显式同意时不在这里凭空创建同意。
  adoptPrivacyConsentForCurrentUser: function () {
    var current = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    if (!ownerId || !current || !current.consentedAt || current.version !== config.PRIVACY_VERSION) {
      return false;
    }
    if (current.userId && String(current.userId) !== ownerId) {
      return false;
    }
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: current.version,
      consentedAt: current.consentedAt,
      userId: ownerId,
      scopes: ['privacy', 'face', 'health', 'ai'],
    });
    return true;
  },

  // 同步微信当前隐私授权状态；用户撤回或平台要求重新授权时，使本地记录失效
  refreshPrivacyAuthorization: function (callback) {
    if (!wx.getPrivacySetting) {
      if (callback) callback(false);
      return;
    }
    wx.getPrivacySetting({
      success: function (res) {
        if (res && res.needAuthorization) {
          try { wx.removeStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED); } catch (e) {}
        }
        if (callback) callback(!!(res && res.needAuthorization));
      },
      fail: function () { if (callback) callback(false); },
    });
  },

  // 当前账号是否已有有效本地同意（含 owner 校验）
  hasPrivacyConsentForCurrentUser: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var scopes = agreed && Array.isArray(agreed.scopes) ? agreed.scopes : [];
    return !!(agreed && agreed.consentedAt &&
      agreed.version === config.PRIVACY_VERSION &&
      String(agreed.userId || '') === this.currentUserId() &&
      ['privacy', 'face', 'health', 'ai'].every(function (scope) {
        return scopes.indexOf(scope) !== -1;
      }));
  },

  // 将微信平台隐私授权同步到测肤子站（服务端 analyze/face-analyze 强校验）
  syncPrivacyConsent: function () {
    lastConsentError = null;
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt || agreed.version !== config.PRIVACY_VERSION) {
      return Promise.resolve(false);
    }
    if (String(agreed.userId || '') !== this.currentUserId()) {
      return Promise.resolve(false);
    }

    var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
    var refreshToken = wx.getStorageSync(config.STORAGE_KEYS.REFRESH_TOKEN) || '';
    if (!token && !refreshToken) return Promise.resolve(false);

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
    }).catch(function (err) {
      lastConsentError = err || null;
      return false;
    });
  },

  getPrivacyConsentError: function () {
    return lastConsentError;
  },
});
