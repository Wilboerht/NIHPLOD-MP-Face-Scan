// 图片上传（对齐 H5 upload-client.ts 流程）
// 注意：子站没有 multipart 上传接口。/api/local-upload 消费的是原始字节流（PUT body），
// wx.uploadFile 固定发 multipart/form-data 会导致魔数校验失败，不可用。
// 正确流程：POST /api/oss/sign 拿签名 → wx.request PUT 原始 ArrayBuffer 到 uploadUrl → 得 publicUrl
var config = require('../config.js');
var requestMod = require('./request.js');
var request = requestMod.request;
var rawRequest = requestMod.rawRequest;

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
 * sign 响应 data: { uploadUrl, publicUrl, objectName }
 *  - OSS 配置时 uploadUrl 是阿里云预签名 https URL（PUT 裸字节，无需鉴权）
 *  - 未配置时降级为 /api/local-upload?path=...（相对路径，需登录 Bearer）
 */
function uploadImage(filePath, filenamePrefix) {
  var meta = resolveImageMeta(filePath);
  var filename = (filenamePrefix || 'image') + '.' + meta.ext;

  return request({
    base: 'advisory',
    url: '/api/oss/sign',
    method: 'POST',
    data: { filename: filename, type: meta.type },
    showError: false,
  }).then(function (res) {
    var data = (res && res.data) || {};
    if (!data.uploadUrl || !data.publicUrl) {
      throw new Error('获取上传签名失败');
    }
    return readFileBuffer(filePath).then(function (buffer) {
      var uploadUrl = data.uploadUrl;
      var isLocalFallback = uploadUrl.charAt(0) === '/';

      var putPromise;
      if (isLocalFallback) {
        // 本地降级：走 request() 以获得 Bearer 注入与 401 刷新重试（local-upload 要求登录）
        putPromise = request({
          base: 'advisory',
          url: uploadUrl,
          method: 'PUT',
          header: { 'Content-Type': meta.type },
          data: buffer,
          timeout: 60000,
          showError: false,
        });
      } else {
        // OSS 预签名直传：裸字节 PUT，不能带 Authorization
        putPromise = rawRequest({
          url: uploadUrl,
          method: 'PUT',
          header: { 'Content-Type': meta.type },
          data: buffer,
          timeout: 60000,
        }).then(function (res) {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error('上传失败（' + res.statusCode + '），请重试');
          }
          return res.data;
        });
      }

      return putPromise.then(function () {
        var publicUrl = data.publicUrl;
        // 本地降级时 publicUrl 是相对路径（/uploads/...），补全为绝对地址
        if (publicUrl.charAt(0) === '/') {
          publicUrl = config.ADVISORY_BASE_URL + publicUrl;
        }
        return publicUrl;
      });
    });
  });
}

module.exports = {
  uploadImage: uploadImage,
};
