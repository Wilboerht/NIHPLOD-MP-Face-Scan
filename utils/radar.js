// 十维雷达图绘制（canvas 2d）
// data: [{ label, score(0-100) }] 固定十维顺序；centerScore: 中心总分（可空）

var GRID_COLOR = '#ddd6c7';
var AXIS_COLOR = '#ddd6c7';
var LABEL_COLOR = '#5a5546';
var DATA_STROKE = '#3D4430';
var DATA_FILL = 'rgba(61, 68, 48, 0.2)';

function pointAt(cx, cy, r, angleRad) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

// size: 画布边长（逻辑 px），dpr: 设备像素比（wx.getWindowInfo().pixelRatio）
function drawRadar(canvas, size, dpr, data, centerScore) {
  var ctx = canvas.getContext('2d');
  var n = data.length;
  if (n < 3) return;

  // dpr 缩放：缓冲放大 dpr 倍，逻辑坐标不变，保证高分屏不模糊
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.scale(dpr, dpr);

  var cx = size / 2;
  var cy = size / 2;
  var R = size / 2 - 58; // 留出标签与顶点数值的空间（长标签防裁切）
  var startAngle = -Math.PI / 2; // 第一维在正上方
  var step = (Math.PI * 2) / n;

  ctx.clearRect(0, 0, size, size);

  // 底网格：3 圈（33% / 66% / 100%）
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (var ring = 1; ring <= 3; ring++) {
    var r = (R * ring) / 3;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var p = pointAt(cx, cy, r, startAngle + step * i);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // 轴线 + 维度标签
  ctx.strokeStyle = AXIS_COLOR;
  ctx.font = '10px sans-serif';
  ctx.fillStyle = LABEL_COLOR;
  for (var j = 0; j < n; j++) {
    var a = startAngle + step * j;
    var edge = pointAt(cx, cy, R, a);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(edge.x, edge.y);
    ctx.stroke();

    var lp = pointAt(cx, cy, R + 14, a);
    ctx.textAlign = Math.abs(Math.cos(a)) < 0.3 ? 'center' : (Math.cos(a) > 0 ? 'left' : 'right');
    ctx.textBaseline = Math.abs(Math.sin(a)) < 0.3 ? 'middle' : (Math.sin(a) > 0 ? 'top' : 'bottom');
    ctx.fillText(data[j].label, lp.x, lp.y);
  }

  // 数据多边形（半透明填充 + 描边）
  ctx.beginPath();
  for (var k = 0; k <= n; k++) {
    var idx = k % n;
    var score = typeof data[idx].score === 'number' ? data[idx].score : 0;
    var dr = (R * Math.max(0, Math.min(100, score))) / 100;
    var dp = pointAt(cx, cy, dr, startAngle + step * idx);
    if (k === 0) ctx.moveTo(dp.x, dp.y);
    else ctx.lineTo(dp.x, dp.y);
  }
  ctx.closePath();
  ctx.fillStyle = DATA_FILL;
  ctx.fill();
  ctx.strokeStyle = DATA_STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 顶点数值
  ctx.font = '10px sans-serif';
  ctx.fillStyle = DATA_STROKE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (var m = 0; m < n; m++) {
    var score2 = typeof data[m].score === 'number' ? data[m].score : 0;
    var vr = (R * Math.max(0, Math.min(100, score2))) / 100;
    var va = startAngle + step * m;
    // 沿径向外移 12px，避免数值压住多边形顶点
    var vp = pointAt(cx, cy, vr + 12, va);
    ctx.fillText(String(Math.round(score2)), vp.x, vp.y);
  }

  // 中心总分
  if (typeof centerScore === 'number') {
    ctx.font = '600 30px sans-serif';
    ctx.fillStyle = DATA_STROKE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(centerScore)), cx, cy - 8);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText('综合评分', cx, cy + 18);
  }
}

module.exports = { drawRadar: drawRadar };
