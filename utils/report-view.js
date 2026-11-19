// ReportView 跨端适配：优先使用服务端 /api/advisor/reports/:id/view，
// 失败时由调用方回退到旧 session/status 原始结果。
var config = require('../config.js');
var request = require('./request.js').request;
var util = require('./util.js');

var KEYS = config.STORAGE_KEYS;
var plainText = util.plainText;
var VIEW_CACHE_PREFIX = 'mp_report_view_';
// 报告会归档/失效，缓存不能永久命中；短 TTL + 重新拉取
var VIEW_CACHE_TTL_MS = 5 * 60 * 1000;

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
    if (view._ownerId !== ownerId ||
        !view._fetchedAt ||
        Date.now() - view._fetchedAt > VIEW_CACHE_TTL_MS) {
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
    cached._fetchedAt = Date.now();
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

function clearCachedView(sessionId) {
  if (!sessionId) return;
  try { wx.removeStorageSync(cacheKey(sessionId)); } catch (e) {}
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

var SKIN_STATE_LABELS = {
  bare: '纯素颜',
  sunscreen: '只涂了防晒',
  washed: '刚洗完脸',
  light_makeup: '淡妆',
  heavy_makeup: '浓妆',
};

var DATA_SOURCE_LABELS = {
  hybrid: '面部影像 + 问卷',
  questionnaire: '仅问卷',
  comprehensive: '面部影像 + 问卷',
};

function toPageData(view) {
  var meta = (view && view.meta) || {};
  var summary = (view && view.summary) || {};
  var dims = Array.isArray(view && view.dimensions) ? view.dimensions : [];
  var findings = Array.isArray(view && view.findings) ? view.findings : [];
  var zones = Array.isArray(view && view.zones) ? view.zones : [];
  var conditions = Array.isArray(view && view.conditions) ? view.conditions : [];

  var dimensionList = dims.map(function (d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      key: d.key,
      label: dimensionLabel(d.key, d.label),
      score: typeof d.score === 'number' ? Math.round(d.score) : null,
      gradeLabel: plainText(gradeLabel(d)),
      details: plainText(d.details || ''),
      lowConfidence: !!d.lowConfidence,
      notVisible: !!d.notVisible,
      attention: !d.notVisible && typeof d.score === 'number' && d.score < 70,
      blackheads: typeof d.blackheads === 'number' ? d.blackheads : null,
      pimples: typeof d.pimples === 'number' ? d.pimples : null,
    };
  });

  var dimByKey = {};
  dimensionList.forEach(function (d) { dimByKey[d.key] = d; });

  var issues = findings.map(function (f) {
    f = f && typeof f === 'object' ? f : {};
    var evidence = (Array.isArray(f.evidence) ? f.evidence : []).filter(function (e) {
      var dim = dimByKey[e.key];
      return !dim || (!dim.notVisible && !dim.lowConfidence);
    });
    return {
      id: f.id,
      title: plainText(f.title || ''),
      severity: f.severity,
      severityLabel: plainText(f.severityLabel || ''),
      observation: plainText(f.observation || ''),
      directCauses: plainText(f.directCauses || ''),
      indirectCauses: plainText(f.indirectCauses || ''),
      skincarePlan: plainText(f.skincarePlan || ''),
      lifestylePlan: plainText(f.lifestylePlan || ''),
      medicalBoundary: plainText(f.medicalBoundary || ''),
      evidenceText: evidence.map(function (e) {
        return plainText(e.label || e.key) + (typeof e.score === 'number' ? ' ' + e.score + ' 分' : '');
      }).join(' · '),
    };
  });

  var zoneList = zones.map(function (z) {
    z = z && typeof z === 'object' ? z : {};
    return {
      key: z.key,
      label: z.label || util.ZONE_LABELS[z.key] || z.key,
      condition: plainText(z.condition || ''),
      advice: plainText(z.advice || ''),
      needsAttention: !!z.needsAttention,
      scores: Array.isArray(z.scores) ? z.scores : [],
    };
  }).filter(function (z) {
    return z.needsAttention || z.condition || z.advice || z.scores.length > 0;
  });

  var coverage = meta.coverage;
  var coverageText = '';
  if (coverage && typeof coverage.scored === 'number' && typeof coverage.total === 'number') {
    coverageText = '基于 ' + coverage.scored + '/' + coverage.total + ' 个有效维度';
    if (coverage.lowConfidence && coverage.lowConfidence.length) {
      coverageText += ' · ' + coverage.lowConfidence.length + ' 维低置信';
    }
    if (coverage.notVisible && coverage.notVisible.length) {
      coverageText += ' · ' + coverage.notVisible.length + ' 维不可见';
    }
  }

  var routine = view && view.routine ? {
    morning: (view.routine.morning || []).map(function (step, index) {
      return {
        key: 'm' + index,
        text: plainText(step.text || ''),
        productName: plainText(step.productName || ''),
        category: plainText(step.category || ''),
        howToUse: plainText(step.howToUse || ''),
      };
    }),
    night: (view.routine.night || []).map(function (step, index) {
      return {
        key: 'n' + index,
        text: plainText(step.text || ''),
        productName: plainText(step.productName || ''),
        category: plainText(step.category || ''),
        howToUse: plainText(step.howToUse || ''),
      };
    }),
    note: plainText(view.routine.note || ''),
    formulaCore: plainText(view.routine.formulaCore || ''),
    onlyOneSet: plainText(view.routine.onlyOneSet || ''),
    routineNote: plainText(view.routine.routineNote || ''),
  } : null;

  var rawSafety = view && view.safety ? view.safety : null;
  var safetyList = function (value) {
    return (Array.isArray(value) ? value : []).map(plainText).filter(Boolean);
  };
  var safety = rawSafety ? {
    excluded: safetyList(rawSafety.excluded),
    actives: safetyList(rawSafety.actives),
    conflicts: safetyList(rawSafety.conflicts),
    patchTest: plainText(rawSafety.patchTest || ''),
    sunProtection: plainText(rawSafety.sunProtection || ''),
    whenToSeeDoctor: safetyList(rawSafety.whenToSeeDoctor),
    excludedText: safetyList(rawSafety.excluded).join('、'),
    activesText: safetyList(rawSafety.actives).join('、'),
    conflictsText: safetyList(rawSafety.conflicts).join('；'),
    doctorText: safetyList(rawSafety.whenToSeeDoctor).join('；'),
  } : null;

  var hasFindingBoundary = issues.some(function (issue) { return !!issue.medicalBoundary; });
  if (safety && hasFindingBoundary) {
    safety.whenToSeeDoctor = [];
    safety.doctorText = '';
  }

  var next = view && view.next ? {
    retestFocus: Array.isArray(view.next.retestFocus) ? view.next.retestFocus.map(plainText).filter(Boolean) : [],
    retestInDays: view.next.retestInDays,
  } : null;
  var nextFocusText = next && Array.isArray(next.retestFocus)
    ? next.retestFocus.filter(Boolean).join('、')
    : '';
  var topFinding = summary.topFinding ? {
    id: summary.topFinding.id,
    title: plainText(summary.topFinding.title || ''),
    severity: summary.topFinding.severity,
    severityLabel: plainText(summary.topFinding.severityLabel || ''),
    observation: plainText(summary.topFinding.observation || ''),
  } : null;
  var skinStateLabel = SKIN_STATE_LABELS[meta.skinState] || '';
  var dataSourceLabel = DATA_SOURCE_LABELS[meta.dataSource] || '';
  var skinAgeRange = Array.isArray(meta.skinAgeRange) && meta.skinAgeRange.length === 2
    ? meta.skinAgeRange[0] + '–' + meta.skinAgeRange[1] + ' 岁'
    : '';

  return {
    viewMeta: meta,
    nickname: meta.nickname || '',
    analyzedAt: meta.analyzedAt ? util.formatTime(meta.analyzedAt) : '',
    skinTypeLabel: plainText(meta.skinTypeLabel || ''),
    skinAge: typeof meta.skinAge === 'number' ? meta.skinAge : null,
    overallScore: typeof meta.overallScore === 'number' ? Math.round(meta.overallScore) : null,
    summary: plainText(summary.overview || ''),
    topFinding: topFinding,
    strengths: Array.isArray(summary.strengths) ? summary.strengths.map(plainText).filter(Boolean) : [],
    nextStep: plainText(summary.nextStep || ''),
    hasRadar: dimensionList.length >= 3,
    dimensionList: dimensionList,
    issues: issues,
    zoneList: zoneList,
    conditions: conditions.map(function (c, index) {
      c = c && typeof c === 'object' ? c : {};
      var item = {};
      for (var key in c) {
        if (Object.prototype.hasOwnProperty.call(c, key)) {
          item[key] = typeof c[key] === 'string' ? plainText(c[key]) : c[key];
        }
      }
      item.key = (item.condition || '') + '|' + (item.area || '') + '|' + index;
      return item;
    }),
    products: view && Array.isArray(view.products) ? view.products : [],
    routine: routine,
    safety: safety,
    next: next,
    nextFocusText: nextFocusText,
    skinAgeRange: skinAgeRange,
    skinStateLabel: skinStateLabel,
    dataSource: meta.dataSource || '',
    dataSourceLabel: dataSourceLabel,
    coverageText: coverageText,
    narrativeSource: meta.narrativeSource || '',
    validationMessage: plainText(meta.validationMessage || ''),
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
  clearCachedView: clearCachedView,
  fetchView: fetchView,
  fetchSummary: fetchSummary,
  toPageData: toPageData,
};
