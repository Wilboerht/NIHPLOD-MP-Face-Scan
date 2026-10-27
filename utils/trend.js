// 肌肤变化趋势折线图（canvas 2d）
// 风格与 utils/radar.js 一致：dates 为 ISO 时间数组、scores 为 0-100 分数（已按天聚合、升序）

var LINE_COLOR = '#8a6d4b';
var FILL_TOP = 'rgba(138, 109, 75, 0.16)';
var FILL_BOTTOM = 'rgba(138, 109, 75, 0.01)';
var GRID_COLOR = 'rgba(43, 43, 43, 0.08)';
var LABEL_COLOR = '#5f5a54';
var DOT_STROKE = '#ffffff';

// ISO 时间 → "M/D"（与 H5 趋势图 x 轴口径一致）
function fmtMonthDay(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.getMonth() + 1 + '/' + d.getDate();
}

// canvas: canvas 2d 节点；width/height: 逻辑 px；dpr: 设备像素比
function drawTrend(canvas, width, height, dpr, dates, scores) {
  var ctx = canvas.getContext('2d');
  var n = dates && dates.length ? dates.length : 0;
  if (n < 2 || width <= 0 || height <= 0) return;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  var padL = 34;
  var padR = 14;
  var padT = 14;
  var padB = 26;
  var plotW = width - padL - padR;
  var plotH = height - padT - padB;

  // 分数范围：上下各留 6 分，钳制 0-100；区间过窄时强制展开避免线贴边
  var min = scores[0];
  var max = scores[0];
  for (var i = 1; i < n; i++) {
    if (scores[i] < min) min = scores[i];
    if (scores[i] > max) max = scores[i];
  }
  var lo = Math.max(0, min - 6);
  var hi = Math.min(100, max + 6);
  if (hi - lo < 12) {
    var mid = (lo + hi) / 2;
    lo = Math.max(0, mid - 6);
    hi = Math.min(100, mid + 6);
  }

  function px(idx) {
    return padL + (plotW * idx) / (n - 1);
  }
  function py(score) {
    return padT + plotH * (1 - (score - lo) / (hi - lo));
  }

  // 水平参考线（3 条）+ 分数刻度
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (var g = 0; g <= 2; g++) {
    var lineScore = lo + ((hi - lo) * g) / 2;
    var gy = py(lineScore);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(width - padR, gy);
    ctx.stroke();
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(String(Math.round(lineScore)), padL - 6, gy);
  }

  // 面积填充（折线下方 → 基线）
  ctx.beginPath();
  ctx.moveTo(px(0), py(scores[0]));
  for (var k = 1; k < n; k++) ctx.lineTo(px(k), py(scores[k]));
  ctx.lineTo(px(n - 1), padT + plotH);
  ctx.lineTo(px(0), padT + plotH);
  ctx.closePath();
  var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, FILL_TOP);
  grad.addColorStop(1, FILL_BOTTOM);
  ctx.fillStyle = grad;
  ctx.fill();

  // 折线
  ctx.beginPath();
  ctx.moveTo(px(0), py(scores[0]));
  for (var j = 1; j < n; j++) ctx.lineTo(px(j), py(scores[j]));
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // 数据点：点数少时全画，否则只保留最新一点
  function dot(idx, r) {
    ctx.beginPath();
    ctx.arc(px(idx), py(scores[idx]), r, 0, Math.PI * 2);
    ctx.fillStyle = LINE_COLOR;
    ctx.fill();
    ctx.strokeStyle = DOT_STROKE;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (n <= 40) {
    for (var m = 0; m < n - 1; m++) dot(m, 2.5);
  }
  dot(n - 1, 4);

  // x 轴首尾日期
  ctx.font = '11px sans-serif';
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(fmtMonthDay(dates[0]), padL, padT + plotH + 8);
  ctx.textAlign = 'right';
  ctx.fillText(fmtMonthDay(dates[n - 1]), width - padR, padT + plotH + 8);
}

module.exports = { drawTrend: drawTrend };
