// 通用工具：日期格式化与展示用标签映射（标签口径与 H5 src/lib/advisor-labels.ts 一致）

// 客户端本地日历日 YYYY-MM-DD（analyze 请求 clientDate 字段要求该格式）
function clientDateStr(d) {
  var date = d || new Date();
  var m = date.getMonth() + 1;
  var day = date.getDate();
  return date.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

// 媒体 URL 归一化：服务端可能返回相对路径（/uploads/...），补全为绝对地址。
// base 默认子站（图片上传/报告资产）；官网头像等资料类资产传 official
function absUrl(url, base) {
  if (!url) return '';
  if (url.charAt(0) === '/') {
    var origin = base === 'official' ? 'https://nihplod.cn' : 'https://smart.nihplod.cn';
    return origin + url;
  }
  return url;
}

// ISO 时间 → 本地可读字符串
function formatTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var p = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 十维标签（同 H5 DIMENSION_LABELS）
var DIMENSION_LABELS = {
  waterOil: '水油平衡',
  skinTone: '肤色均衡度',
  spots: '色斑状况',
  wrinkles: '细纹皱纹',
  uvDamage: '光老化程度',
  sensitivity: '肌肤敏感度',
  darkCircles: '黑眼圈',
  firmness: '皮肤弹性',
  acne: '粉刺/痤疮',
  radiance: '光泽度',
};

var GRADE_LABELS = {
  excellent: '优秀',
  good: '良好',
  average: '中等',
  fair: '一般',
  poor: '较差',
};

var SEVERITY_LABELS = {
  mild: '轻度',
  moderate: '中度',
  severe: '重度',
};

// 区域分析标签（zoneAnalysis 的 6 个区域，同 H5 ZoneAnalysis）
var ZONE_LABELS = {
  forehead: '额头',
  tZone: 'T区',
  leftCheek: '左脸颊',
  rightCheek: '右脸颊',
  eyeArea: '眼周',
  jawline: '下颌线',
};

// 拍摄时肌肤状态（face-analyze / analyze 的 skinState 字段，值同 H5 约定）
var SKIN_STATE_OPTIONS = [
  { value: 'bare', label: '素颜' },
  { value: 'sunscreen', label: '涂了防晒' },
  { value: 'washed', label: '刚洗完脸' },
  { value: 'light_makeup', label: '淡妆' },
  { value: 'heavy_makeup', label: '浓妆' },
];

module.exports = {
  clientDateStr: clientDateStr,
  formatTime: formatTime,
  absUrl: absUrl,
  DIMENSION_LABELS: DIMENSION_LABELS,
  GRADE_LABELS: GRADE_LABELS,
  SEVERITY_LABELS: SEVERITY_LABELS,
  ZONE_LABELS: ZONE_LABELS,
  SKIN_STATE_OPTIONS: SKIN_STATE_OPTIONS,
};
