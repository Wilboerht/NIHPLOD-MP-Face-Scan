// 小程序埋点：与 H5 /api/advisor/analytics/track 共用事件枚举。
// 分析前事件使用本地 analytics session；报告/产品事件可传报告 sessionId，便于与漏斗 join。
var request = require('./request.js').request;
var uuid = require('./uuid.js').uuid;

var ANALYTICS_SESSION_KEY = 'mp_analytics_session_id';

function getSessionId() {
  try {
    var existing = wx.getStorageSync(ANALYTICS_SESSION_KEY);
    if (existing) return existing;
    var next = uuid();
    wx.setStorageSync(ANALYTICS_SESSION_KEY, next);
    return next;
  } catch (e) {
    return uuid();
  }
}

function setSessionId(sessionId) {
  if (!sessionId) return;
  try { wx.setStorageSync(ANALYTICS_SESSION_KEY, sessionId); } catch (e) {}
}

// 只在已登录时发送：后端只保存登录用户事件；未登录调用会触发 401 跳登录，反而干扰主流程
function track(event, data, sessionId) {
  var auth = require('./auth.js');
  if (!auth.isLoggedIn()) return Promise.resolve();
  return request({
    base: 'advisory',
    url: '/api/advisor/analytics/track',
    method: 'POST',
    showError: false,
    data: {
      sessionId: sessionId || getSessionId(),
      event: event,
      data: data || {},
      timestamp: new Date().toISOString(),
    },
  }).catch(function () { return null; });
}

module.exports = {
  getSessionId: getSessionId,
  setSessionId: setSessionId,
  track: track,
};
