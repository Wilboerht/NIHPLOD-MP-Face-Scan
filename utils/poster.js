// 证书海报端侧合成（完整移植自 H5 src/lib/cert-image.ts 的 renderCertImage）
// 底图：8 派 × 男女成品证书 1440×1920（静态元素已烘焙），此处只叠加动态数据
// 版式：
//   qr   标准版（/images/cert/）：含二维码 + 评分夹板 → 叠加 昵称/总分/百分位/建议
//   noqr 分享版（/images/cert-noqr/，小红书角标）：无二维码无评分区 → 叠加 昵称/百分位/建议（换行）
var config = require('../config.js');

var CERT_WIDTH = 1440;
var CERT_HEIGHT = 1920;
var TEXT_COLOR = '#324F63'; // 取样自底图烘焙文字
var FONT_STACK = '"PingFang SC", "Microsoft YaHei", sans-serif';

var VALID_PERSONAS = {
  sensitive: true, minimalist: true, luxury: true, ageless: true,
  desert: true, oily: true, combination: true, guardian: true,
};

// 派系建议（与 H5 result-content.json 的 m7.suggestions 前 2 条标题保持一致，用于证书叠加；
// 仅取标题短句——H5 端同源；若 H5 配置更新需同步此表）
var PERSONA_ADVICE = {
  sensitive: ['优先修复屏障再叠加功效', '舒缓成分建议日常维持使用，不局限急救场景'],
  minimalist: ['优先选对产品，而非堆砌产品', '选定方案后减少频繁更换'],
  luxury: ['优先关注配方技术，不只看营销宣传', '综合考量产品全维度体验'],
  ageless: ['兼顾成分与渗透技术', '重视成分协同，规避冲突叠加'],
  desert: ['不能只注重补水，补油锁水优先级很高', '严格控制清洁强度'],
  oily: ['拒绝过度清洁', '控油同时不能省略保湿'],
  combination: ['分区处理诉求', '同一瓶面霜通过涂抹厚薄实现分区'],
  guardian: ['防晒是对抗光老化最重要防线', '抗氧化建议提前布局'],
};

// 非法 persona 回退 guardian；gender 仅 male/female，其它回退 female（与 H5 certImageUrl 一致）
function certImageUrl(persona, gender, variant) {
  var p = VALID_PERSONAS[persona] ? persona : 'guardian';
  var g = gender === 'male' ? 'male' : 'female';
  var dir = variant === 'noqr' ? '/images/cert-noqr/' : '/images/cert/';
  return config.ADVISORY_BASE_URL + dir + p + '_' + g + '.webp';
}

// 派系建议（前 2 条；persona 非法回退 guardian，必然有值）
function getPersonaAdvice(persona) {
  var p = VALID_PERSONAS[persona] ? persona : 'guardian';
  return (PERSONA_ADVICE[p] || PERSONA_ADVICE.guardian).slice(0, 2);
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

// 按字符贪心换行（中文无空格，逐字断行即可）；返回行数组（与 H5 wrapText 同构）
function wrapText(ctx, text, maxWidth) {
  var lines = [];
  var line = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (line && ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// 建议清洗：过滤空串、最多 2 条（与 H5 cert-image 口径一致）
function cleanAdvice(advice) {
  if (!Array.isArray(advice)) return [];
  return advice
    .filter(function (s) { return typeof s === 'string' && !!s.trim(); })
    .slice(0, 2);
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
function loadCertImage(canvas, persona, gender, variant) {
  var url = certImageUrl(persona, gender, variant);
  return loadCanvasImage(canvas, url).catch(function () {
    if ((VALID_PERSONAS[persona] ? persona : 'guardian') === 'guardian') {
      throw new Error('证书底图下载失败');
    }
    return loadCanvasImage(canvas, certImageUrl('guardian', gender, variant));
  });
}

// qr 标准版：标题下昵称行 + 评分夹板总分 + 圆环百分位 + 建议（每条一行）
// 坐标与对齐口径与 H5 drawQrOverlays 完全一致；ctx 复用需逐块显式设置对齐（防状态泄漏）
function drawQrOverlays(ctx, input) {
  ctx.fillStyle = TEXT_COLOR;

  if (input.nickname && String(input.nickname).trim()) {
    ctx.font = '36px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, String(input.nickname).trim() + '的肌智派系是：', 550), 88, 290);
  }

  if (typeof input.score === 'number' && isFinite(input.score)) {
    ctx.font = '600 114px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(Math.round(input.score)), 282, 1305);
  }

  if (typeof input.percentile === 'number' && isFinite(input.percentile)) {
    ctx.font = '600 54px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(input.percentile + '%', 565, 1155);
  }

  var advice = cleanAdvice(input.advice);
  ctx.font = '30px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (var i = 0; i < advice.length; i++) {
    ctx.fillText(fitText(ctx, String(advice[i]).trim(), 500), 90, 700 + i * 44);
  }
}

// noqr 分享版：左侧昵称行（限宽 500）+ 圆环百分位 + 建议区（逐字换行，最多 4 行）
// 坐标与对齐口径与 H5 drawNoqrOverlays 完全一致
function drawNoqrOverlays(ctx, input) {
  ctx.fillStyle = TEXT_COLOR;

  if (input.nickname && String(input.nickname).trim()) {
    ctx.font = '36px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, String(input.nickname).trim() + '的肌智派系是：', 500), 207, 420);
  }

  if (typeof input.percentile === 'number' && isFinite(input.percentile)) {
    ctx.font = '600 54px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(input.percentile + '%', 395, 995);
  }

  var advice = cleanAdvice(input.advice);
  if (advice.length > 0) {
    ctx.font = '24px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var wrapped = [];
    advice.forEach(function (line) {
      wrapped = wrapped.concat(wrapText(ctx, String(line).trim(), 330));
    });
    var MAX_LINES = 4;
    var overflow = wrapped.length > MAX_LINES;
    var shown = wrapped.slice(0, MAX_LINES);
    if (overflow) shown[MAX_LINES - 1] = fitText(ctx, shown[MAX_LINES - 1] + '…', 330);
    for (var i = 0; i < shown.length; i++) {
      ctx.fillText(shown[i], 222, 1430 + i * 34);
    }
  }
}

/**
 * 生成证书海报并导出临时文件路径
 * canvas: canvas 2d 节点
 * input: { persona, gender, nickname, score, percentile, advice }
 * variant: 'qr' 标准版（默认）| 'noqr' 分享版
 * resolve(tempFilePath)
 */
function generatePoster(canvas, input, variant) {
  var v = variant === 'noqr' ? 'noqr' : 'qr';
  return loadCertImage(canvas, input.persona, input.gender, v).then(function (img) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CERT_WIDTH, CERT_HEIGHT);
    ctx.drawImage(img, 0, 0, CERT_WIDTH, CERT_HEIGHT);
    if (v === 'noqr') drawNoqrOverlays(ctx, input);
    else drawQrOverlays(ctx, input);
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
  getPersonaAdvice: getPersonaAdvice,
  generatePoster: generatePoster,
};
