// 证书海报端侧合成（移植自 H5 src/lib/cert-image.ts 的 qr 版 drawQrOverlays）
// 底图：8 派 × 男女成品证书 1440×1920（静态元素已烘焙），此处只叠加动态数据
var config = require('../config.js');

var CERT_WIDTH = 1440;
var CERT_HEIGHT = 1920;
var TEXT_COLOR = '#324F63'; // 取样自底图烘焙文字
var FONT_STACK = '"PingFang SC", "Microsoft YaHei", sans-serif';

var VALID_PERSONAS = {
  sensitive: true, minimalist: true, luxury: true, ageless: true,
  desert: true, oily: true, combination: true, guardian: true,
};

// 非法 persona 回退 guardian；gender 仅 male/female，其它回退 female（与 H5 certImageUrl 一致）
function certImageUrl(persona, gender) {
  var p = VALID_PERSONAS[persona] ? persona : 'guardian';
  var g = gender === 'male' ? 'male' : 'female';
  return config.ADVISORY_BASE_URL + '/images/cert/' + p + '_' + g + '.webp';
}

// 超宽文本截断加省略号（canvas maxWidth 是横向挤压而不是截断，手动处理）
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  var t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// 网络图需先 wx.getImageInfo 下载到本地临时路径，再用 canvas.createImage 绘制
function loadCanvasImage(canvas, url) {
  return new Promise(function (resolve, reject) {
    wx.getImageInfo({
      src: url,
      success: function (info) {
        var img = canvas.createImage();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('证书底图解析失败')); };
        img.src = info.path;
      },
      fail: function () { reject(new Error('证书底图下载失败')); },
    });
  });
}

// 带 guardian 兜底：某派系/性别底图 404 时用 guardian 底图重试一次
function loadCertImage(canvas, persona, gender) {
  var url = certImageUrl(persona, gender);
  return loadCanvasImage(canvas, url).catch(function () {
    if ((VALID_PERSONAS[persona] ? persona : 'guardian') === 'guardian') {
      throw new Error('证书底图下载失败');
    }
    return loadCanvasImage(canvas, certImageUrl('guardian', gender));
  });
}

// 叠加动态数据（坐标与 H5 drawQrOverlays 完全一致）
// input: { nickname, score, percentile, advice[] }
function drawOverlays(ctx, input) {
  ctx.fillStyle = TEXT_COLOR;

  if (input.nickname && String(input.nickname).trim()) {
    ctx.font = '36px ' + FONT_STACK;
    ctx.fillText(fitText(ctx, String(input.nickname).trim() + '的肌智派系是：', 550), 88, 290);
  }

  if (typeof input.score === 'number' && isFinite(input.score)) {
    ctx.font = '600 114px ' + FONT_STACK;
    ctx.fillText(String(Math.round(input.score)), 282, 1305);
  }

  if (typeof input.percentile === 'number' && isFinite(input.percentile)) {
    ctx.font = '600 54px ' + FONT_STACK;
    ctx.fillText(input.percentile + '%', 565, 1155);
  }

  var advice = Array.isArray(input.advice) ? input.advice.slice(0, 2) : [];
  ctx.font = '30px ' + FONT_STACK;
  for (var i = 0; i < advice.length; i++) {
    ctx.fillText(fitText(ctx, String(advice[i]).trim(), 500), 90, 700 + i * 44);
  }
}

/**
 * 生成证书海报并导出临时文件路径
 * canvas: canvas 2d 节点；input: { persona, gender, nickname, score, percentile, advice }
 * resolve(tempFilePath)
 */
function generatePoster(canvas, input) {
  return loadCertImage(canvas, input.persona, input.gender).then(function (img) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CERT_WIDTH, CERT_HEIGHT);
    ctx.drawImage(img, 0, 0, CERT_WIDTH, CERT_HEIGHT);
    drawOverlays(ctx, input);
    return new Promise(function (resolve, reject) {
      // 固定导出 1440×1920：canvas 缓冲即输出尺寸，无需 dpr 缩放（导出图不经过屏幕渲染）
      wx.canvasToTempFilePath({
        canvas: canvas,
        x: 0,
        y: 0,
        width: CERT_WIDTH,
        height: CERT_HEIGHT,
        destWidth: CERT_WIDTH,
        destHeight: CERT_HEIGHT,
        success: function (res) { resolve(res.tempFilePath); },
        fail: function () { reject(new Error('海报导出失败')); },
      });
    });
  });
}

module.exports = {
  CERT_WIDTH: CERT_WIDTH,
  CERT_HEIGHT: CERT_HEIGHT,
  certImageUrl: certImageUrl,
  generatePoster: generatePoster,
};
