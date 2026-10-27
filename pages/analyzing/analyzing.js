var config = require('../../config.js');
var request = require('../../utils/request.js').request;
var uuid = require('../../utils/uuid.js').uuid;
var util = require('../../utils/util.js');
var auth = require('../../utils/auth.js');

var KEYS = config.STORAGE_KEYS;
var POLL_INTERVAL_MS = 3000;   // 与 H5 useAsyncAnalysis 一致：3s × 60 = 180s 总轮询
var POLL_MAX_ATTEMPTS = 60;
// 失败会话保留窗口：同一份答案 + 同一张照片在窗口内重试复用 sessionId，
// 服务端按 sessionId 复用 TestRecord 预占，不重复扣测肤次数/AI 调用
var PENDING_TTL_MS = 30 * 60 * 1000;

// 稳定序列化：答案对象 key 顺序不影响指纹
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
}

function buildFingerprint(answers, skinState, faceImagePath) {
  return stableStringify(answers || {}) + '|' + (skinState || '') + '|' + (faceImagePath || '');
}

Page({
  data: {
    stageText: '正在准备…',
    progress: 2,
    error: '',
    running: false,
  },

  onLoad: function () {
    this._pollTimer = null;
    this._progressTimer = null;
    this._finished = false;
    this._running = false;
    this._sessionId = '';
    this._faceAnalysis = null;
    this._pendingFingerprint = '';
    this.run();
  },

  onUnload: function () {
    this._finished = true; // 页面已卸载：防止在途请求回调继续调度轮询
    this._running = false;
    this.stopTimers();
  },

  stopTimers: function () {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
  },

  ensureConsent: function () {
    var app = getApp();
    if (!app || !app.syncPrivacyConsent) return Promise.resolve(true);
    return app.syncPrivacyConsent();
  },

  // 模拟进度条：阶段跳变 + 缓慢填充（避免卡在 99%）
  startProgress: function () {
    var self = this;
    if (this._progressTimer) return;
    this._progressTimer = setInterval(function () {
      var p = self.data.progress;
      var target = self.data.progress < 55 ? 55 : 85;
      if (p < target) {
        self.setData({ progress: Math.min(target, p + (target - p > 20 ? 0.4 : 0.1)) });
      }
    }, 300);
  },

  // --------------------------------------------------------------------------
  // 失败会话暂存：退出页面/重试时复用同一个 sessionId 与服务端预占
  // --------------------------------------------------------------------------
  loadPending: function (fingerprint) {
    try {
      var pending = wx.getStorageSync(KEYS.PENDING_ANALYSIS);
      if (!pending || !pending.sessionId || pending.fingerprint !== fingerprint) return false;
      if (Date.now() - (pending.createdAt || 0) > PENDING_TTL_MS) {
        wx.removeStorageSync(KEYS.PENDING_ANALYSIS);
        return false;
      }
      this._sessionId = pending.sessionId;
      this._faceAnalysis = pending.faceAnalysis || null;
      return true;
    } catch (e) {
      return false;
    }
  },

  savePending: function () {
    if (!this._sessionId || !this._pendingFingerprint) return;
    try {
      wx.setStorageSync(KEYS.PENDING_ANALYSIS, {
        sessionId: this._sessionId,
        fingerprint: this._pendingFingerprint,
        faceAnalysis: this._faceAnalysis || null,
        createdAt: Date.now(),
      });
    } catch (e) {}
  },

  clearPending: function () {
    try { wx.removeStorageSync(KEYS.PENDING_ANALYSIS); } catch (e) {}
  },

  run: function () {
    var self = this;
    if (self._running) return;
    self._running = true;
    self._finished = false;
    self.stopTimers();
    self.setData({ error: '', stageText: '正在准备…', progress: 2, running: true });
    if (wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({
        message: '分析尚未完成，离开后可能需要重新分析，确定离开吗？',
      });
    }
    self.startProgress();

    var answers = wx.getStorageSync(KEYS.ANSWERS) || null;
    if (!answers || Object.keys(answers).length === 0) {
      self.fail('答题数据缺失，请重新填写问卷');
      return;
    }

    var skinState = wx.getStorageSync(KEYS.SKIN_STATE) || undefined;
    var faceImagePath = wx.getStorageSync(KEYS.FACE_IMAGE_PATH) || '';
    var fingerprint = buildFingerprint(answers, skinState, faceImagePath);

    // 同一份答案 + 同一张照片：复用上次失败会话；否则开新会话
    var reused = false;
    if (self._sessionId && self._pendingFingerprint === fingerprint) {
      reused = true;
    } else if (self.loadPending(fingerprint)) {
      reused = true;
    }
    if (!reused) {
      self._sessionId = uuid();
      self._faceAnalysis = null;
      self.clearPending();
    }

    var sessionId = self._sessionId;
    self._pendingFingerprint = fingerprint;
    self.savePending();

    var facePromise = self.ensureConsent().then(function (consentOk) {
      if (!consentOk) {
        throw new Error('隐私授权同步失败，请返回首页重新同意隐私政策');
      }
      if (self._faceAnalysis) {
        // 上一次 face-analyze 已成功：跳过视觉调用，直接用缓存结果继续 analyze
        self.setData({ stageText: '继续生成专属护肤报告…', progress: 65 });
        return self._faceAnalysis;
      }
      return self.readImageAsBase64(faceImagePath).then(function (imageData) {
        if (!imageData) return null;
        self.setData({ stageText: 'AI 正在分析面部照片…', progress: 25 });
        // POST /api/advisor/face-analyze
        // body 同 H5 useAsyncAnalysis：{ sessionId(uuid), images: [{data, angle}], skinState }
        // 响应为面部分析结果本体（skinType/dimensions/overallScore/...，非包装结构）
        // 服务端最长 90s（maxDuration=100），客户端超时给到 100s
        return request({
          base: 'advisory',
          url: '/api/advisor/face-analyze',
          method: 'POST',
          timeout: 100000,
          showError: false,
          data: {
            sessionId: sessionId,
            images: [{ data: imageData, angle: 'front' }],
            skinState: skinState,
          },
        }).then(function (faceAnalysis) {
          self._faceAnalysis = faceAnalysis || null;
          self.savePending();
          return faceAnalysis;
        });
      });
    });

    facePromise
      .then(function (faceAnalysis) {
        self.setData({ stageText: '正在生成专属护肤报告…', progress: 65 });
        // 昵称随 analyze 上报：子站 analyze 会把它写入报告/证书；
        // 主站昵称上限 20，子站 schema 已同步放宽到 20
        var user = auth.getUser() || {};
        var nickname = String(user.name || '').trim();
        if (nickname.length > 20) nickname = nickname.slice(0, 20);

        // POST /api/advisor/analyze（H5 AnalyzeRequestSchema）
        // 202 → 已有同 session 请求在分析中，转轮询 session/status
        return request({
          base: 'advisory',
          url: '/api/advisor/analyze',
          method: 'POST',
          timeout: 100000,
          showError: false,
          data: {
            answers: answers,
            faceAnalysis: faceAnalysis || undefined,
            sessionId: sessionId,
            nickname: nickname || undefined,
            privacyConsent: getApp().getPrivacyConsentPayload() || undefined,
            clientDate: util.clientDateStr(new Date()),
            skinState: skinState,
          },
        }).then(function (res) {
          if (res && res.status === 'analyzing') {
            return self.pollResult(sessionId);
          }
          return res;
        });
      })
      .then(function (result) {
        if (self._finished) return;
        if (!result) throw new Error('未获取到分析结果，请重试一次');
        // 服务端缓存/异步结果可能缺 faceAnalysis，用本次视觉结果补齐（与 H5 一致）
        if (self._faceAnalysis && !result.faceAnalysis) result.faceAnalysis = self._faceAnalysis;
        result.sessionId = sessionId;
        // 本地缓存只是加速回看；存储配额满时不能影响成功页跳转
        try { wx.setStorageSync(KEYS.RESULT_PREFIX + sessionId, result); } catch (e) {}
        try { wx.setStorageSync(KEYS.LATEST_SESSION, sessionId); } catch (e) {}
        self.clearPending();
        // 分析完成：本地不再需要人脸照片路径（报告/证书均不依赖）
        try { wx.removeStorageSync(KEYS.FACE_IMAGE_PATH); } catch (e) {}
        try { wx.removeStorageSync(KEYS.FACE_IMAGE_SIDE_PATHS); } catch (e) {}
        self._faceAnalysis = null;
        self._running = false;
        self._finished = true;
        self.stopTimers();
        self.setData({ progress: 100, stageText: '分析完成', running: false });
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
        // reLaunch 避免系统返回落回拍摄页
        wx.reLaunch({ url: '/pages/result/result?sessionId=' + sessionId });
      })
      .catch(function (err) {
        if (self._finished) return;
        self.fail((err && err.message) || '分析失败，请重试');
      });
  },

  // 读本地照片为 base64 data URL；无照片（或读取失败）→ null，降级为纯问卷分析
  // 超过服务端单张上限时再做一次更小尺寸压缩，仍超限则明确提示用户
  readImageAsBase64: function (filePath) {
    if (!filePath) return Promise.resolve(null);

    function readBase64(path) {
      return new Promise(function (resolve) {
        wx.getFileSystemManager().readFile({
          filePath: path,
          encoding: 'base64',
          success: function (res) { resolve(res.data || ''); },
          fail: function () { resolve(''); },
        });
      });
    }

    function compressForRetry(path) {
      return new Promise(function (resolve) {
        wx.compressImage({
          src: path,
          quality: 50,
          compressedWidth: 720,
          success: function (res) { resolve(res.tempFilePath || ''); },
          fail: function () { resolve(''); },
        });
      });
    }

    return readBase64(filePath).then(function (base64) {
      if (!base64) {
        wx.showToast({ title: '照片读取失败，本次仅按问卷分析', icon: 'none', duration: 2500 });
        return null;
      }
      // 服务端单张上限约 1.1MB base64（MAX_IMAGE_BASE64_CHARS=1500000）
      if (base64.length <= 1400000) return 'data:image/jpeg;base64,' + base64;

      return compressForRetry(filePath)
        .then(function (compressedPath) {
          if (!compressedPath) return '';
          return readBase64(compressedPath);
        })
        .then(function (retryBase64) {
          if (!retryBase64 || retryBase64.length > 1400000) {
            wx.showToast({ title: '照片过大，本次仅按问卷分析', icon: 'none', duration: 2500 });
            return null;
          }
          return 'data:image/jpeg;base64,' + retryBase64;
        });
    });
  },

  // 轮询 GET /api/advisor/session/status?sessionId=
  // completed → {status, sessionId, result, rawResult}；取 rawResult（与 H5 一致）
  pollResult: function (sessionId) {
    var self = this;
    var attempt = 0;
    return new Promise(function (resolve, reject) {
      function tick() {
        if (self._finished) return; // 页面已卸载
        attempt += 1;
        request({
          base: 'advisory',
          url: '/api/advisor/session/status?sessionId=' + encodeURIComponent(sessionId),
          method: 'GET',
          showError: false,
        }).then(function (res) {
          if (res.status === 'completed') {
            if (res.rawResult) resolve(res.rawResult);
            else reject(new Error('分析结果异常，请重试'));
            return;
          }
          if (res.status === 'not_found' || res.status === 'forbidden') {
            reject(new Error('会话不存在或无权访问'));
            return;
          }
          if (attempt >= POLL_MAX_ATTEMPTS) {
            reject(new Error('分析结果准备时间有点长，请重试一次'));
            return;
          }
          self.setData({ progress: Math.min(90, 65 + attempt) });
          self._pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        }).catch(function (err) {
          // 会话不存在/无权访问（服务端统一返回 404）→ 立即失败，不再空转轮询
          if (err && (err.statusCode === 404 || err.statusCode === 403)) {
            reject(new Error('会话不存在或无权访问'));
            return;
          }
          // 网络抖动时继续轮询，不轻易失败
          if (attempt >= POLL_MAX_ATTEMPTS) {
            reject(err);
            return;
          }
          self._pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
        });
      }
      tick();
    });
  },

  fail: function (message) {
    this._running = false;
    this.stopTimers();
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    this.setData({ running: false, error: message, stageText: '分析未完成' });
    this.savePending();
  },

  onRetry: function () {
    if (this._running) return;
    this.run();
  },

  onBack: function () {
    wx.navigateBack({
      fail: function () {
        wx.reLaunch({ url: '/pages/index/index' });
      },
    });
  },
});
