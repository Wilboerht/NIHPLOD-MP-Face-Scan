// 头像上传：主站 OAuth 专用端点（/api/oauth/userinfo/avatar）
// wx.uploadFile 固定 multipart/form-data，字段名 file；401 时刷新 token 重试一次
var config = require('../config.js');
var requestMod = require('./request.js');

function uploadAvatar(filePath) {
  if (!filePath) return Promise.reject(new Error('未选择头像图片'));

  function send() {
    var token = wx.getStorageSync(config.STORAGE_KEYS.ACCESS_TOKEN) || '';
    return new Promise(function (resolve, reject) {
      wx.uploadFile({
        url: config.OFFICIAL_BASE_URL + '/api/oauth/userinfo/avatar',
        filePath: filePath,
        name: 'file',
        header: token ? { Authorization: 'Bearer ' + token } : {},
        timeout: 60000,
        success: function (res) {
          var body = {};
          try { body = JSON.parse(res.data || '{}'); } catch (e) {}
          if (res.statusCode >= 200 && res.statusCode < 300 && body.success && body.data && body.data.url) {
            resolve(body.data.url);
            return;
          }
          if (res.statusCode === 403 && requestMod.isAccountDisabledData(body)) {
            reject(requestMod.handleAccountDisabled(body));
            return;
          }
          var err = new Error(
            requestMod.extractErrorMessage(body, '头像上传失败（' + res.statusCode + '）')
          );
          err.statusCode = res.statusCode;
          err.data = body;
          err.needRefresh = res.statusCode === 401;
          reject(err);
        },
        fail: function () {
          reject(new Error('网络连接异常，头像上传失败，请重试'));
        },
      });
    });
  }

  return send().catch(function (err) {
    if (!err || !err.needRefresh) throw err;
    var auth = require('./auth.js');
    return requestMod.refreshSession().then(send).catch(function (retryErr) {
      if (retryErr && retryErr.isSessionStale) throw retryErr;
      if (retryErr && (retryErr.isRefreshRejected || retryErr.statusCode === 401)) {
        if (!auth.isRecentLogout()) {
          auth.clearSession({ preserveFlow: true });
          requestMod.redirectToLogin('登录已过期，请重新登录');
        }
      }
      throw retryErr || err;
    });
  });
}

module.exports = {
  uploadAvatar: uploadAvatar,
};
