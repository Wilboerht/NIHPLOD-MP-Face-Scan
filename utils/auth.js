// 登录态管理：微信小程序一键登录 / token 刷新 / 登出
// 对接官网已实现接口：
//   登录 POST {OFFICIAL}/api/auth/wechat/miniprogram-login  body {code}
//   刷新 POST {OFFICIAL}/api/oauth/token  body {grant_type, refresh_token, client_id}
var config = require('../config.js');
var rawRequest = require('./request.js').rawRequest;

var KEYS = config.STORAGE_KEYS;

function wxLogin() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) {
        if (res.code) resolve(res.code);
        else reject(new Error('微信登录失败，请重试'));
      },
      fail: function () { reject(new Error('微信登录失败，请重试')); },
    });
  });
}

// 保存登录会话（响应 data 字段：accessToken / refreshToken / expiresIn / user / needBinding / bindToken）
function saveSession(data) {
  wx.setStorageSync(KEYS.ACCESS_TOKEN, data.accessToken || '');
  if (data.refreshToken) wx.setStorageSync(KEYS.REFRESH_TOKEN, data.refreshToken);
  var expiresIn = Number(data.expiresIn) || 7200;
  // 提前 5 分钟视为过期，给刷新留出余量
  wx.setStorageSync(KEYS.TOKEN_EXPIRES_AT, Date.now() + (expiresIn - 300) * 1000);
  if (data.user) {
    // 官网返回 nickname/avatar，小程序端统一为 name/avatarUrl（各页面均按此读取）
    var u = data.user;
    var rawAvatar = u.avatarUrl || u.avatar || '';
    // 服务端可能返回相对路径（/uploads/...），补全为绝对地址（官网域名，头像存在官网）
    if (rawAvatar.charAt(0) === '/') rawAvatar = 'https://nihplod.cn' + rawAvatar;
    wx.setStorageSync(KEYS.USER_INFO, {
      id: u.id,
      name: u.name || u.nickname || '',
      avatarUrl: rawAvatar,
      membershipLevel: u.membershipLevel,
      phoneBound: u.phoneBound,
    });
  }
  wx.setStorageSync(KEYS.NEED_BINDING, !!data.needBinding);
  if (data.bindToken) wx.setStorageSync('mp_bind_token', data.bindToken);
  // 绑定完成/已绑定账号登录后清理一次性 bindToken，避免长期滞留
  if (!data.needBinding) wx.removeStorageSync('mp_bind_token');
}

/**
 * 一键登录：wx.login → miniprogram-login → 存 token + user
 * resolve 登录响应 data（含 needBinding；本期只记录状态，不强制绑定手机号）
 */
function login() {
  return wxLogin().then(function (code) {
    return rawRequest({
      base: 'official',
      url: '/api/auth/wechat/miniprogram-login',
      method: 'POST',
      data: { code: code, clientId: config.MP_CLIENT_ID },
      timeout: 30000,
    });
  }).then(function (res) {
    var body = res.data || {};
    if (res.statusCode !== 200 || !body.success || !body.data) {
      var msg = (body.error && body.error.message) || body.error || '登录失败，请重试';
      throw new Error(typeof msg === 'string' ? msg : '登录失败，请重试');
    }
    // needBinding=true 时无 accessToken：新用户需先一键绑手机号（bindToken 已存）
    if (body.data.needBinding) {
      saveSession(body.data);
      return body.data;
    }
    if (!body.data.accessToken) {
      throw new Error('登录失败，请重试');
    }
    saveSession(body.data);
    return body.data;
  });
}

/**
 * 新用户一键绑定手机号并完成登录（免短信：微信 getPhoneNumber 授权码直验）
 * 调用时机：login() 返回 needBinding=true 后，用户点击 getPhoneNumber 按钮
 */
function bindPhoneAndLogin(phoneCode) {
  return wxLogin().then(function (code) {
    return rawRequest({
      base: 'official',
      url: '/api/auth/wechat/miniprogram-login',
      method: 'POST',
      data: { code: code, phoneCode: phoneCode, clientId: config.MP_CLIENT_ID },
      timeout: 30000,
    });
  }).then(function (res) {
    var body = res.data || {};
    if (res.statusCode !== 200 || !body.success || !body.data || !body.data.accessToken) {
      var msg = (body.error && body.error.message) || body.error || '绑定失败，请重试';
      throw new Error(typeof msg === 'string' ? msg : '绑定失败，请重试');
    }
    saveSession(body.data);
    return body.data;
  });
}

/**
 * 静默刷新 token（public client，无 secret）
 * 注意：token 端点的响应字段命名（accessToken vs access_token）以官网实际为准，此处两种均兼容
 */
function refresh() {
  var refreshToken = wx.getStorageSync(KEYS.REFRESH_TOKEN) || '';
  if (!refreshToken) {
    var emptyErr = new Error('无刷新令牌');
    emptyErr.isRefreshRejected = true; // 无凭证可恢复：按登录失效处理
    return Promise.reject(emptyErr);
  }
  return rawRequest({
    base: 'official',
    url: '/api/oauth/token',
    method: 'POST',
    data: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.MP_CLIENT_ID,
    },
    timeout: 30000,
  }).then(function (res) {
    var body = res.data || {};
    var payload = body.data || body;
    var accessToken = payload.accessToken || payload.access_token;
    if (res.statusCode !== 200 || !accessToken) {
      var err = new Error('登录已过期，请重新登录');
      err.statusCode = res.statusCode;
      // 4xx（除 429）：服务端明确拒绝刷新（invalid_grant 等）→ 登录失效；
      // 429/5xx：服务端暂时不可用，保留登录态交由调用方处理
      err.isRefreshRejected =
        res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 429;
      throw err;
    }
    saveSession({
      accessToken: accessToken,
      refreshToken: payload.refreshToken || payload.refresh_token || refreshToken,
      expiresIn: payload.expiresIn || payload.expires_in,
      user: payload.user,
      needBinding: !!wx.getStorageSync(KEYS.NEED_BINDING),
    });
    return payload;
  });
}

// 清除本地登录态与个人敏感缓存（人脸照片路径 / 问卷答案 / 报告缓存 / 最近会话）
// 保留 PRIVACY_AGREED：隐私同意是设备级状态，与账号无关
function clearSession() {
  wx.removeStorageSync(KEYS.ACCESS_TOKEN);
  wx.removeStorageSync(KEYS.REFRESH_TOKEN);
  wx.removeStorageSync(KEYS.TOKEN_EXPIRES_AT);
  wx.removeStorageSync(KEYS.USER_INFO);
  wx.removeStorageSync(KEYS.NEED_BINDING);
  wx.removeStorageSync('mp_bind_token');
  wx.removeStorageSync(KEYS.FACE_IMAGE_PATH);
  wx.removeStorageSync(KEYS.FACE_IMAGE_SIDE_PATHS);
  wx.removeStorageSync(KEYS.ANSWERS);
  wx.removeStorageSync(KEYS.SKIN_STATE);
  wx.removeStorageSync(KEYS.LATEST_SESSION);
  wx.removeStorageSync(KEYS.PENDING_ANALYSIS);
  try {
    var keys = wx.getStorageInfoSync().keys || [];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(KEYS.RESULT_PREFIX) === 0) wx.removeStorageSync(keys[i]);
    }
  } catch (e) {}
}

// 服务端撤销 refresh token（RFC 7009 端点，public client 仅需 client_id）：
// fire-and-forget，失败静默，不阻塞也不回滚本地登出
function revokeServerToken(refreshToken) {
  if (!refreshToken) return;
  rawRequest({
    base: 'official',
    url: '/api/oauth/revoke',
    method: 'POST',
    data: {
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: config.MP_CLIENT_ID,
    },
    timeout: 5000,
  }).catch(function () {});
}

// 登出：先取出凭证用于服务端撤销，再清理本地登录态与敏感缓存
function logout() {
  var refreshToken = wx.getStorageSync(KEYS.REFRESH_TOKEN) || '';
  clearSession();
  revokeServerToken(refreshToken);
}

// 是否已登录（有 refreshToken 即视为可恢复登录态，过期由请求层自动刷新）
function isLoggedIn() {
  return !!(wx.getStorageSync(KEYS.ACCESS_TOKEN) || wx.getStorageSync(KEYS.REFRESH_TOKEN));
}

function getUser() {
  return wx.getStorageSync(KEYS.USER_INFO) || null;
}

module.exports = {
  login: login,
  bindPhoneAndLogin: bindPhoneAndLogin,
  refresh: refresh,
  logout: logout,
  clearSession: clearSession,
  isLoggedIn: isLoggedIn,
  getUser: getUser,
};
