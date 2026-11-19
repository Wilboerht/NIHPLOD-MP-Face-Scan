var config = require('./config.js');

var ALL_CONSENT_SCOPES = ['privacy', 'terms', 'face', 'health', 'ai'];
var CONSENT_RECHECK_MS = 5 * 60 * 1000;
var lastConsentError = null;
var consentCheckedAt = 0;
var consentCheckedUserId = '';

function hasAllConsentScopes(record) {
  var scopes = record && Array.isArray(record.scopes) ? record.scopes : [];
  return ALL_CONSENT_SCOPES.every(function (scope) {
    return scopes.indexOf(scope) !== -1;
  });
}

function clearLocalConsent() {
  try { wx.removeStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED); } catch (e) {}
  consentCheckedAt = 0;
  consentCheckedUserId = '';
}

App({
  globalData: {},

  onLaunch: function () {
    try {
      require('./utils/auth.js').cleanupStaleFlowState();
    } catch (e) {}
  },

  // 记录隐私授权同意（用于 analyze 请求的 privacyConsent 审计载荷）。
  // 实际授权由微信官方隐私弹窗完成（见 pages/index 的 wx.requirePrivacyAuthorize）。
  currentUserId: function () {
    var user = wx.getStorageSync(config.STORAGE_KEYS.USER_INFO) || {};
    return user && user.id ? String(user.id) : '';
  },

  // pendingSync=true 表示这是用户刚刚主动给出的同意，允许向服务端补授权；
  // 已同步的历史同意不会因为再次进入页面而自动重新授予（避免覆盖服务端撤回）。
  recordPrivacyConsent: function (options) {
    var current = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    var forceSync = !!(options && options.pendingSync);
    if (current && current.consentedAt && current.version === config.PRIVACY_VERSION &&
        String(current.userId || '') === ownerId && hasAllConsentScopes(current)) {
      if (forceSync && !current.pendingSync) {
        current.pendingSync = true;
        wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, current);
        consentCheckedAt = 0;
        consentCheckedUserId = '';
      }
      return;
    }
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: config.PRIVACY_VERSION,
      consentedAt: new Date().toISOString(),
      userId: ownerId,
      scopes: ALL_CONSENT_SCOPES.slice(),
      pendingSync: true,
    });
    consentCheckedAt = 0;
    consentCheckedUserId = '';
  },

  // 读取 analyze 请求需要的 privacyConsent 载荷（H5 AnalyzeRequestSchema 同名字段）
  getPrivacyConsentPayload: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    if (!agreed || !agreed.consentedAt) return null;
    if (String(agreed.userId || '') !== this.currentUserId()) return null;
    return { version: agreed.version || config.PRIVACY_VERSION, consentedAt: agreed.consentedAt };
  },

  // 登录成功后，把登录前在设备上给出的同版本同意记录绑定到当前账号；
  // 不完整的旧记录不自动扩权，交给 index 重新显式同意。
  adoptPrivacyConsentForCurrentUser: function () {
    var current = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    if (!ownerId || !current || !current.consentedAt || current.version !== config.PRIVACY_VERSION) {
      return false;
    }
    if (current.userId && String(current.userId) !== ownerId) {
      return false;
    }
    if (!hasAllConsentScopes(current)) {
      return false;
    }
    wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, {
      version: current.version,
      consentedAt: current.consentedAt,
      userId: ownerId,
      scopes: ALL_CONSENT_SCOPES.slice(),
      pendingSync: !!current.pendingSync,
    });
    consentCheckedAt = 0;
    consentCheckedUserId = '';
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
          clearLocalConsent();
        }
        if (callback) callback(!!(res && res.needAuthorization));
      },
      fail: function () { if (callback) callback(false); },
    });
  },

  // 当前账号是否已有有效本地同意（含 owner 校验）
  hasPrivacyConsentForCurrentUser: function () {
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    return !!(agreed && agreed.consentedAt &&
      agreed.version === config.PRIVACY_VERSION &&
      String(agreed.userId || '') === this.currentUserId() &&
      hasAllConsentScopes(agreed));
  },

  // 只读核对服务端同意状态：服务端明确缺失时清本地，网络异常不擅自清。
  // 本地待同步（pendingSync）时不拦截，交给 syncPrivacyConsent 完成首次授权。
  reconcilePrivacyConsent: function (callback) {
    var done = function (value) { if (callback) callback(value); };
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    if (!agreed || !agreed.consentedAt || agreed.version !== config.PRIVACY_VERSION ||
        String(agreed.userId || '') !== ownerId || !hasAllConsentScopes(agreed)) {
      done(false);
      return;
    }
    if (agreed.pendingSync) {
      done(true);
      return;
    }
    if (consentCheckedAt && consentCheckedUserId === ownerId &&
        Date.now() - consentCheckedAt < CONSENT_RECHECK_MS) {
      done(true);
      return;
    }
    var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
    var refreshToken = wx.getStorageSync(config.STORAGE_KEYS.REFRESH_TOKEN) || '';
    if (!token && !refreshToken) {
      done(true);
      return;
    }
    var request = require('./utils/request.js').request;
    request({
      base: 'advisory',
      url: '/api/account/consent',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var state = (res && res.data) || res || {};
      var granted = Array.isArray(state.granted) ? state.granted : [];
      if (ALL_CONSENT_SCOPES.every(function (scope) { return granted.indexOf(scope) !== -1; })) {
        consentCheckedAt = Date.now();
        consentCheckedUserId = ownerId;
        done(true);
        return;
      }
      if (Array.isArray(state.granted) || Array.isArray(state.missing)) {
        clearLocalConsent();
        done(false);
        return;
      }
      done(true);
    }).catch(function () {
      // 网络/服务端异常时保留本地同意，避免每次抖动都要求重新授权
      done(true);
    });
  },

  // 将微信平台隐私授权同步到测肤子站（服务端 analyze/face-analyze 强校验）
  // 先读服务端状态：已全部授权则只标记同步；只有本地 pendingSync 才允许补授权。
  syncPrivacyConsent: function () {
    lastConsentError = null;
    var agreed = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
    var ownerId = this.currentUserId();
    if (!agreed || !agreed.consentedAt || agreed.version !== config.PRIVACY_VERSION) {
      return Promise.resolve(false);
    }
    if (String(agreed.userId || '') !== ownerId) {
      return Promise.resolve(false);
    }
    if (!hasAllConsentScopes(agreed)) {
      return Promise.resolve(false);
    }

    var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
    var refreshToken = wx.getStorageSync(config.STORAGE_KEYS.REFRESH_TOKEN) || '';
    if (!token && !refreshToken) return Promise.resolve(false);

    var pendingSync = !!agreed.pendingSync;
    var request = require('./utils/request.js').request;

    function markSynced() {
      var latest = wx.getStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED);
      if (latest && latest.version === config.PRIVACY_VERSION &&
          String(latest.userId || '') === ownerId) {
        latest.pendingSync = false;
        wx.setStorageSync(config.STORAGE_KEYS.PRIVACY_AGREED, latest);
        consentCheckedAt = Date.now();
        consentCheckedUserId = ownerId;
      }
      lastConsentError = null;
    }

    function grant() {
      return request({
        base: 'advisory',
        url: '/api/account/consent',
        method: 'POST',
        showError: false,
        data: {
          agreed: true,
          version: config.PRIVACY_VERSION,
          scopes: ALL_CONSENT_SCOPES.slice(),
        },
      }).then(function () {
        markSynced();
        return true;
      }).catch(function (err) {
        lastConsentError = err || null;
        return false;
      });
    }

    return request({
      base: 'advisory',
      url: '/api/account/consent',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var state = (res && res.data) || res || {};
      var granted = Array.isArray(state.granted) ? state.granted : [];
      if (ALL_CONSENT_SCOPES.every(function (scope) { return granted.indexOf(scope) !== -1; })) {
        markSynced();
        return true;
      }
      if (!pendingSync) {
        if (Array.isArray(state.granted) || Array.isArray(state.missing)) {
          clearLocalConsent();
          return false;
        }
        lastConsentError = new Error('隐私授权状态异常，请返回首页重试');
        return false;
      }
      return grant();
    }).catch(function (err) {
      if (err && err.statusCode === 401) {
        lastConsentError = err;
        return false;
      }
      if (pendingSync) return grant();
      lastConsentError = err || null;
      return false;
    });
  },

  getPrivacyConsentError: function () {
    return lastConsentError;
  },
});
