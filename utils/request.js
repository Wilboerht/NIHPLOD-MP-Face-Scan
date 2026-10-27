// 统一请求封装
// - base: 'official'（官网 nihplod.cn，登录/刷新） | 'advisory'（子站 smart.nihplod.cn，业务接口）
// - 子站请求自动注入 Authorization: Bearer <accessToken>
// - 401 → 静默刷新一次并重试原请求（Promise 锁防止并发重复刷新）；
//   仅刷新被服务端明确拒绝（4xx，除 429）或重试仍 401 时清登录态回登录页，
//   网络错误/5xx 保留登录态，错误原样抛给调用方
// - 统一解析服务端错误格式：{error: string} / {error: {code, message, details}} / {message} /
//   OAuth 端点 {error, error_description}
var config = require('../config.js');

var BASE_MAP = {
  official: config.OFFICIAL_BASE_URL,
  advisory: config.ADVISORY_BASE_URL,
};

// 并发刷新锁：同一时间只允许一个刷新请求在途，其余等待同一个 Promise
var refreshPromise = null;

function buildUrl(path, base) {
  if (/^https?:\/\//.test(path)) return path;
  var origin = BASE_MAP[base] || BASE_MAP.advisory;
  return origin + path;
}

// 解析服务端错误文案（对齐 H5 useAsyncAnalysis.ts 的 getServerErrorMessage）
function extractErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data.message === 'string') return data.message;
  // OAuth 端点错误格式：{ error: 错误码, error_description: 人类可读文案 }
  if (typeof data.error_description === 'string' && data.error_description) return data.error_description;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error === 'object') {
    if (typeof data.error.message === 'string') {
      if (typeof data.error.details === 'string' && data.error.details) {
        return data.error.message + '：' + data.error.details;
      }
      return data.error.message;
    }
  }
  return fallback;
}

// 底层请求：不做鉴权/重试，resolve 原始响应（含非 2xx），网络层错误才 reject
function rawRequest(options) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: buildUrl(options.url, options.base),
      method: options.method || 'GET',
      data: options.data,
      header: Object.assign({ 'Content-Type': 'application/json' }, options.header || {}),
      timeout: options.timeout || 60000,
      dataType: 'json',
      success: function (res) { resolve(res); },
      fail: function (err) {
        var errMsg = (err && err.errMsg) || '';
        var msg = errMsg.indexOf('timeout') > -1
          ? '请求超时，请检查网络后重试'
          : '网络连接异常，请检查网络后重试';
        var error = new Error(msg);
        error.isNetworkError = true;
        reject(error);
      },
    });
  });
}

// 共享刷新 Promise（lazy require 避免与 auth.js 循环依赖）
function doRefresh() {
  if (!refreshPromise) {
    var auth = require('./auth.js');
    refreshPromise = auth.refresh().then(
      function (data) { refreshPromise = null; return data; },
      function (err) { refreshPromise = null; throw err; }
    );
  }
  return refreshPromise;
}

// 登录失效回登录页：toast 提示 + 防并发重复 reLaunch（已在登录页则跳过）
var redirecting = false;
function redirectToLogin(message) {
  if (redirecting) return;
  var pages = getCurrentPages();
  var top = pages && pages.length ? pages[pages.length - 1] : null;
  if (top && top.route === 'pages/login/login') return;

  // 记录当前受保护页面，登录成功后由 login.finishLogin 跳回（如报告深链）
  if (top && top.route) {
    try {
      wx.setStorageSync(config.STORAGE_KEYS.PENDING_ROUTE, {
        route: top.route,
        options: top.options || {},
        at: Date.now(),
      });
    } catch (e) {}
  }

  redirecting = true;
  wx.showToast({ title: message || '登录已过期，请重新登录', icon: 'none' });
  wx.reLaunch({
    url: '/pages/login/login',
    complete: function () {
      setTimeout(function () { redirecting = false; }, 1000);
    },
  });
}

// 账号禁用：主站 OAuth 资源返回 {error:'account_disabled'}，
// 登录接口返回 {error:{code:'ACCOUNT_DISABLED'}}，两种格式都识别
function isAccountDisabledData(data) {
  if (!data) return false;
  if (data.error === 'account_disabled') return true;
  if (data.error && typeof data.error === 'object') {
    return data.error.code === 'ACCOUNT_DISABLED' || data.error.code === 'account_disabled';
  }
  return data.code === 'ACCOUNT_DISABLED' || data.code === 'account_disabled';
}

function handleAccountDisabled(data) {
  var auth = require('./auth.js');
  auth.clearSession();
  redirectToLogin('账号已被禁用，请联系客服');
  var err = new Error('账号已被禁用，请联系客服');
  err.statusCode = 403;
  err.data = data;
  err.isAccountDisabled = true;
  return err;
}

// 是否在发送前主动刷新：已进入过期缓冲期（saveSession 已按提前 5 分钟标记）时先换新 token，
// 避免大体积请求（人脸 base64 等）401 后整包重发；无完整凭证时不触发（游客流程不受影响）
function shouldRefreshBeforeSend() {
  var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
  var refreshToken = wx.getStorageSync(config.STORAGE_KEYS.REFRESH_TOKEN) || '';
  if (!token || !refreshToken) return false;
  var expiresAt = Number(wx.getStorageSync(config.STORAGE_KEYS.TOKEN_EXPIRES_AT)) || 0;
  return expiresAt > 0 && Date.now() >= expiresAt;
}

function handleResponse(res, showError, base) {
  var data = res.data;
  // 2xx 直接放行（analyze 的 202 "分析中"信号也在此返回，由调用方判断）
  if (res.statusCode >= 200 && res.statusCode < 300) return data;
  // 账号被禁用
  if (res.statusCode === 403 && isAccountDisabledData(data)) {
    // 子站单独禁用：只限制测肤功能，不清主站登录态（用户仍可使用积分/资料等主站能力）
    if (base === 'advisory') {
      var advisoryMessage = extractErrorMessage(data, '测肤功能已被限制，请联系客服');
      var advisoryError = new Error(advisoryMessage);
      advisoryError.statusCode = 403;
      advisoryError.data = data;
      advisoryError.isAdvisoryDisabled = true;
      if (showError) {
        wx.showToast({ title: String(advisoryMessage).slice(0, 28), icon: 'none', duration: 2500 });
      }
      throw advisoryError;
    }
    // 主站账号被禁用：清会话 + 全局回登录页
    throw handleAccountDisabled(data);
  }
  var message = extractErrorMessage(data, '请求失败（' + res.statusCode + '）');
  var error = new Error(message);
  error.statusCode = res.statusCode;
  error.data = data;
  // 游客限额等场景的登录引导标记（H5 返回 requireLogin: true）
  if (data && data.requireLogin) error.requireLogin = true;
  if (showError) {
    wx.showToast({ title: String(message).slice(0, 28), icon: 'none', duration: 2500 });
  }
  throw error;
}

/**
 * 业务请求
 * options: {
 *   url, base: 'official'|'advisory', method, data, header, timeout,
 *   skipAuth: 不注入 Bearer（登录/刷新自身用 rawRequest，业务公开接口如 questions 可设 true），
 *   showError: 默认 true，失败统一 toast；调用方需自行处理错误文案时设 false
 * }
 */
function request(options) {
  var opts = options || {};
  var skipAuth = !!opts.skipAuth;
  var showError = opts.showError !== false;
  // 区分主站/子站错误语义：子站 ACCOUNT_DISABLED 只限制测肤，不清主站登录态
  var base = opts.base || 'advisory';

  function send() {
    var header = Object.assign({}, opts.header || {});
    if (!skipAuth) {
      var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
      if (token) header.Authorization = 'Bearer ' + token;
    }
    return rawRequest(Object.assign({}, opts, { header: header }));
  }

  // 登录态确实失效：清会话 + 跳登录，返回统一错误
  function sessionExpiredError() {
    var auth = require('./auth.js');
    auth.clearSession();
    redirectToLogin();
    var err = new Error('登录已过期，请重新登录');
    err.statusCode = 401;
    return err;
  }

  // 主动刷新：进入过期缓冲期先换新 token 再发；暂时性失败（网络/5xx/429）不阻塞，
  // 带旧 token 正常发送，由 401 常规路径兜底；服务端明确拒绝则视为登录失效
  var preflight = Promise.resolve();
  if (!skipAuth && shouldRefreshBeforeSend()) {
    preflight = doRefresh().catch(function (err) {
      if (err && err.isRefreshRejected) throw sessionExpiredError();
    });
  }

  return preflight.then(send).then(function (res) {
    if (res.statusCode === 401 && !skipAuth && !opts._retried) {
      opts._retried = true;
      // 401 → 静默刷新一次并重试原请求
      return doRefresh().then(
        function () {
          return send().then(function (retryRes) {
            if (retryRes.statusCode === 401) {
              // 刷新后仍 401：登录态确实失效
              throw sessionExpiredError();
            }
            return handleResponse(retryRes, showError, base);
          });
        },
        function (err) {
          // 刷新失败：仅服务端明确拒绝时清会话回登录页；
          // 网络/5xx/429 保留登录态，错误原样抛给调用方
          if (err && err.isRefreshRejected) throw sessionExpiredError();
          throw err;
        }
      );
    }
    return handleResponse(res, showError, base);
  });
}

module.exports = {
  request: request,
  rawRequest: rawRequest,
  extractErrorMessage: extractErrorMessage,
  isAccountDisabledData: isAccountDisabledData,
  handleAccountDisabled: handleAccountDisabled,
};
