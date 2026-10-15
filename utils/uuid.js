// 生成 UUID v4（小程序无 crypto.randomUUID，face-analyze 的 sessionId 要求 uuid 格式）
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

module.exports = { uuid: uuid };
