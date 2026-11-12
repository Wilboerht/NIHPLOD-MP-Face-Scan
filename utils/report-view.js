// ReportView 跨端适配：优先使用服务端 /api/advisor/reports/:id/view，
// 失败时由调用方回退到旧 session/status 原始结果。
var config = require('../config.js');
var request = require('./request.js').request;
var util = require('./util.js');

var KEYS = config.STORAGE_KEYS;
var VIEW_CACHE_PREFIX = 'mp_report_view_';

function cacheKey(sessionId) {
  return VIEW_CACHE_PREFIX + sessionId;
}

function currentUserId() {
  try {
    var user = wx.getStorageSync(KEYS.USER_INFO) || {};
    return user && user.id ? String(user.id) : '';
  } catch (e) {
    return '';
  }
}

function getCachedView(sessionId) {
  if (!sessionId) return null;
  var ownerId = currentUserId();
  // 未登录/用户信息缺失时不使用缓存，避免共享设备上一位用户的报告被直接渲染
  if (!ownerId) return null;
  try {
    var view = wx.getStorageSync(cacheKey(sessionId));
    if (!view || !view.meta) return null;
    if (view._ownerId !== ownerId) {
      wx.removeStorageSync(cacheKey(sessionId));
      return null;
    }
    return view;
  } catch (e) {
    return null;
  }
}

function setCachedView(sessionId, view) {
  if (!sessionId || !view) return;
  var ownerId = currentUserId();
  if (!ownerId) return;
  try {
    // 浅拷贝后写入归属标记，避免污染调用方持有的 view 对象
    var cached = {};
    for (var key in view) {
      if (Object.prototype.hasOwnProperty.call(view, key)) cached[key] = view[key];
    }
    cached._ownerId = ownerId;
    wx.setStorageSync(cacheKey(sessionId), cached);
  } catch (e) {}
  // 只保留当前报告视图，避免缓存无限增长
  try {
    var keys = wx.getStorageInfoSync().keys || [];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(VIEW_CACHE_PREFIX) === 0 && keys[i] !== cacheKey(sessionId)) {
        wx.removeStorageSync(keys[i]);
      }
    }
  } catch (e) {}
}

function fetchView(sessionId) {
  return request({
    base: 'advisory',
    url: '/api/advisor/reports/' + encodeURIComponent(sessionId) + '/view',
    method: 'GET',
    showError: false,
  }).then(function (res) {
    var view = res && res.view;
    if (!view || !view.meta) throw new Error('报告视图为空');
    setCachedView(sessionId, view);
    return view;
  });
}

function fetchSummary(sessionId) {
  return request({
    base: 'advisory',
    url: '/api/advisor/reports/' + encodeURIComponent(sessionId) + '/view?summary=1',
    method: 'GET',
    showError: false,
  }).then(function (res) {
    return res && res.summary ? res.summary : null;
  });
}

function dimensionLabel(key, fallback) {
  return util.DIMENSION_LABELS[key] || fallback || key;
}

function gradeLabel(item) {
  if (item.gradeLabel) return item.gradeLabel;
  if (item.grade && util.GRADE_LABELS[item.grade]) return util.GRADE_LABELS[item.grade];
  return '';
}

function toPageData(view) {
  var meta = (view && view.meta) || {};
  var summary = (view && view.summary) || {};
  var dims = Array.isArray(view && view.dimensions) ? view.dimensions : [];
  var findings = Array.isArray(view && view.findings) ? view.findings : [];
  var zones = Array.isArray(view && view.zones) ? view.zones : [];
  var conditions = Array.isArray(view && view.conditions) ? view.conditions : [];

  var dimensionList = dims.map(function (d) {
    return {
      key: d.key,
      label: dimensionLabel(d.key, d.label),
      score: typeof d.score === 'number' ? Math.round(d.score) : null,
      gradeLabel: gradeLabel(d),
      details: d.details || '',
      lowConfidence: !!d.lowConfidence,
      notVisible: !!d.notVisible,
      blackheads: typeof d.blackheads === 'number' ? d.blackheads : null,
      pimples: typeof d.pimples === 'number' ? d.pimples : null,
    };
  });

  var issues = findings.map(function (f) {
    var evidence = Array.isArray(f.evidence) ? f.evidence : [];
    return {
      id: f.id,
      title: f.title || '',
      severity: f.severity,
      severityLabel: f.severityLabel || '',
      observation: f.observation || '',
      directCauses: f.directCauses || '',
      indirectCauses: f.indirectCauses || '',
      skincarePlan: f.skincarePlan || '',
      lifestylePlan: f.lifestylePlan || '',
      medicalBoundary: f.medicalBoundary || '',
      evidenceText: evidence.map(function (e) {
        return (e.label || e.key) + (typeof e.score === 'number' ? ' ' + e.score + ' 分' : '');
      }).join(' · '),
    };
  });

  var zoneList = zones.map(function (z) {
    return {
      key: z.key,
      label: z.label || util.ZONE_LABELS[z.key] || z.key,
      condition: z.condition || '',
      advice: z.advice || '',
      needsAttention: !!z.needsAttention,
      scores: Array.isArray(z.scores) ? z.scores : [],
    };
  });

  var coverage = meta.coverage;
  var coverageText = '';
  if (coverage && typeof coverage.scored === 'number' && typeof coverage.total === 'number') {
    coverageText = '基于 ' + coverage.scored + '/' + coverage.total + ' 个有效维度';
    if (coverage.lowConfidence && coverage.lowConfidence.length) {
      coverageText += ' · ' + coverage.lowConfidence.length + ' 维低置信';
    }
  }

  var routine = view && view.routine ? {
    morning: (view.routine.morning || []).map(function (step) {
      return {
        text: step.text || '',
        productName: step.productName || '',
        category: step.category || '',
        howToUse: step.howToUse || '',
      };
    }),
    night: (view.routine.night || []).map(function (step) {
      return {
        text: step.text || '',
        productName: step.productName || '',
        category: step.category || '',
        howToUse: step.howToUse || '',
      };
    }),
    note: view.routine.note || '',
    formulaCore: view.routine.formulaCore || '',
    onlyOneSet: view.routine.onlyOneSet || '',
    routineNote: view.routine.routineNote || '',
  } : null;

  var rawSafety = view && view.safety ? view.safety : null;
  var safety = rawSafety ? {
    excluded: Array.isArray(rawSafety.excluded) ? rawSafety.excluded : [],
    actives: Array.isArray(rawSafety.actives) ? rawSafety.actives : [],
    conflicts: Array.isArray(rawSafety.conflicts) ? rawSafety.conflicts : [],
    patchTest: rawSafety.patchTest || '',
    sunProtection: rawSafety.sunProtection || '',
    whenToSeeDoctor: Array.isArray(rawSafety.whenToSeeDoctor) ? rawSafety.whenToSeeDoctor : [],
    excludedText: (Array.isArray(rawSafety.excluded) ? rawSafety.excluded : []).join('、'),
    activesText: (Array.isArray(rawSafety.actives) ? rawSafety.actives : []).join('、'),
    conflictsText: (Array.isArray(rawSafety.conflicts) ? rawSafety.conflicts : []).join('；'),
    doctorText: (Array.isArray(rawSafety.whenToSeeDoctor) ? rawSafety.whenToSeeDoctor : []).join('；'),
  } : null;

  return {
    viewMeta: meta,
    nickname: meta.nickname || '',
    analyzedAt: meta.analyzedAt ? util.formatTime(meta.analyzedAt) : '',
    skinTypeLabel: meta.skinTypeLabel || '',
    skinAge: typeof meta.skinAge === 'number' ? meta.skinAge : null,
    overallScore: typeof meta.overallScore === 'number' ? Math.round(meta.overallScore) : null,
    summary: summary.overview || '',
    topFinding: summary.topFinding || null,
    strengths: Array.isArray(summary.strengths) ? summary.strengths : [],
    nextStep: summary.nextStep || '',
    hasRadar: dimensionList.length >= 3,
    dimensionList: dimensionList,
    issues: issues,
    zoneList: zoneList,
    conditions: conditions,
    products: view && Array.isArray(view.products) ? view.products : [],
    routine: routine,
    safety: safety,
    next: view && view.next ? view.next : null,
    coverageText: coverageText,
    narrativeSource: meta.narrativeSource || '',
    validationMessage: meta.validationMessage || '',
    skinState: meta.skinState || '',
    // 带妆拍摄提示：与 H5 报告一致，避免用户把妆容问题当成肌肤问题
    makeupWarning: meta.skinState === 'light_makeup' || meta.skinState === 'heavy_makeup'
      ? '本次为带妆拍摄，彩妆可能影响肤色、毛孔与瑕疵判断，建议下次素颜复测。'
      : '',
    legacy: !!(view && view.legacy),
  };
}

module.exports = {
  getCachedView: getCachedView,
  setCachedView: setCachedView,
  fetchView: fetchView,
  fetchSummary: fetchSummary,
  toPageData: toPageData,
};
