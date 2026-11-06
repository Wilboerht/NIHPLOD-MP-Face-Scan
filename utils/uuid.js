// 生成 UUID v4（小程序无 crypto.randomUUID，face-analyze 的 sessionId 要求 uuid 格式）
var pool = null;
var poolOffset = 0;
var filling = false;

function refill() {
  if (filling || typeof wx === 'undefined' || !wx.getRandomValues) return;
  filling = true;
  try {
    wx.getRandomValues({
      length: 256,
      success: function (res) {
        try {
          pool = new Uint8Array(res.randomValues);
          poolOffset = 0;
        } catch (e) {
          pool = null;
        }
        filling = false;
      },
      fail: function () {
        filling = false;
      },
    });
  } catch (e) {
    filling = false;
  }
}

function randomByte() {
  if (!pool || poolOffset >= pool.length) refill();
  if (pool && poolOffset < pool.length) return pool[poolOffset++];
  return (Math.random() * 256) | 0;
}

function uuid() {
  var bytes = [];
  for (var i = 0; i < 16; i++) bytes.push(randomByte());
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  var hex = '';
  for (var j = 0; j < 16; j++) hex += (bytes[j] + 0x100).toString(16).slice(1);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20);
}

refill();

module.exports = { uuid: uuid };
