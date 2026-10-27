// 图片上传（对齐 H5 upload-client.ts 流程）
// 注意：子站没有 multipart 上传接口。/api/local-upload 消费的是原始字节流（PUT body），
// wx.uploadFile 固定发 multipart/form-data 会导致魔数校验失败，不可用。
// 正确流程：POST /api/oss/sign 拿签名 → wx.request PUT 原始 ArrayBuffer 到 uploadUrl → 得 publicUrl
var config = require('../config.js');
var requestMod = require('./request.js');
var request = requestMod.request;

// 读文件为 ArrayBuffer（不传 encoding 即返回 ArrayBuffer）
function readFileBuffer(filePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success: function (res) { resolve(res.data); },
      fail: function () { reject(new Error('读取本地文件失败')); },
    });
  });
}

function getFileSize(filePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileInfo({
      filePath: filePath,
      success: function (res) { resolve(res.size); },
      fail: function () { reject(new Error('读取文件大小失败')); },
    });
  });
}

function uploadToOssPost(filePath, data, meta) {
  return new Promise(function (resolve, reject) {
    wx.uploadFile({
      url: data.uploadUrl,
      filePath: filePath,
      name: 'file',
      formData: {
        key: data.key,
        policy: data.policy,
        OSSAccessKeyId: data.ossAccessKeyId,
        signature: data.signature,
        success_action_status: data.successActionStatus || '201',
        'Content-Type': meta.type,
      },
      timeout: 60000,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data.publicUrl);
          return;
        }
        reject(new Error('上传失败（' + res.statusCode + '），请重试'));
      },
      fail: function () {
        reject(new Error('网络连接异常，上传失败，请重试'));
      },
    });
  });
}

// 从临时路径推断扩展名与 MIME（oss/sign 白名单：jpg/jpeg/png/webp/gif）
function resolveImageMeta(filePath) {
  var m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(filePath || '');
  var ext = m ? m[1].toLowerCase() : '';
  var typeMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  if (!typeMap[ext]) ext = 'jpg';
  return { ext: ext, type: typeMap[ext] };
}

/**
 * 上传图片，resolve 绝对地址的 publicUrl
 * sign 响应 data: { storage, uploadUrl, publicUrl, policy, signature, key, ... }
 *  - OSS 配置时使用 PostObject 表单直传（policy 内含 content-length-range）
 *  - 未配置时降级为 /api/local-upload?path=...（相对路径，需登录 Bearer）
 */
function uploadImage(filePath, filenamePrefix) {
  var meta = resolveImageMeta(filePath);
  var filename = (filenamePrefix || 'image') + '.' + meta.ext;

  return getFileSize(filePath).then(function (size) {
    return request({
      base: 'advisory',
      url: '/api/oss/sign',
      method: 'POST',
      data: { filename: filename, type: meta.type, size: size },
      showError: false,
    });
  }).then(function (res) {
    var data = (res && res.data) || {};
    if (!data.uploadUrl || !data.publicUrl) {
      throw new Error('获取上传签名失败');
    }

    var publicUrl = data.publicUrl;
    if (publicUrl.charAt(0) === '/') {
      publicUrl = config.ADVISORY_BASE_URL + publicUrl;
    }

    if (data.storage === 'oss' || data.policy) {
      return uploadToOssPost(filePath, data, meta).then(function () {
        return publicUrl;
      });
    }

    return readFileBuffer(filePath).then(function (buffer) {
      return request({
        base: 'advisory',
        url: data.uploadUrl,
        method: 'PUT',
        header: { 'Content-Type': meta.type },
        data: buffer,
        timeout: 60000,
        showError: false,
      }).then(function () {
        return publicUrl;
      });
    });
  });
}

// 头像上传：主站 OAuth 专用端点（/api/oss/sign 只认主站会话，小程序 Bearer 不可用）
// wx.uploadFile 固定 multipart/form-data，字段名 file；401 时刷新 token 重试一次
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
    return auth.refresh().then(send).catch(function (retryErr) {
      if (retryErr && (retryErr.isRefreshRejected || retryErr.statusCode === 401)) {
        auth.clearSession();
        wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
        setTimeout(function () {
          wx.reLaunch({ url: '/pages/login/login' });
        }, 600);
      }
      throw retryErr || err;
    });
  });
}

module.exports = {
  uploadImage: uploadImage,
  uploadAvatar: uploadAvatar,
};
