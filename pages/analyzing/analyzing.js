var config = require('../../config.js');
var request = require('../../utils/request.js').request;
var uuid = require('../../utils/uuid.js').uuid;
var util = require('../../utils/util.js');

var KEYS = config.STORAGE_KEYS;
var POLL_INTERVAL_MS = 3000;   // 与 H5 useAsyncAnalysis 一致：3s × 60 = 180s 总轮询
var POLL_MAX_ATTEMPTS = 60;

Page({
  data: {
    stageText: '正在准备…',
    progress: 2,
    error: '',
  },

  onLoad: function () {
    this._pollTimer = null;
    this._progressTimer = null;
    this._finished = false;
    this.startProgress();
    this.run();
  },

  onUnload: function () {
    this._finished = true; // 页面已卸载：防止在途请求回调继续调度轮询
    this.stopTimers();
  },

  stopTimers: function () {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
  },

  // 模拟进度条：阶段跳变 + 缓慢填充（避免卡在 99%）
  startProgress: function () {
    var self = this;
    this._progressTimer = setInterval(function () {
      var p = self.data.progress;
      var target = self.data.progress < 55 ? 55 : 85;
      if (p < target) {
        self.setData({ progress: Math.min(target, p + (target - p > 20 ? 0.4 : 0.1)) });
      }
    }, 300);
  },

  run: function () {
    var self = this;
    this._finished = false;
    this.setData({ error: '', stageText: '正在准备…', progress: 2 });

    var answers = wx.getStorageSync(KEYS.ANSWERS) || null;
    if (!answers || Object.keys(answers).length === 0) {
      this.fail('答题数据缺失，请重新填写问卷');
      return;
    }

    var sessionId = uuid();
    this._sessionId = sessionId;
    var skinState = wx.getStorageSync(KEYS.SKIN_STATE) || undefined;
    var faceImagePath = wx.getStorageSync(KEYS.FACE_IMAGE_PATH) || '';

    this.readImageAsBase64(faceImagePath)
      .then(function (imageData) {
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
        });
      })
      .then(function (faceAnalysis) {
        self.setData({ stageText: '正在生成专属护肤报告…', progress: 65 });
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
        if (!result) throw new Error('未获取到分析结果，请重试一次');
        result.sessionId = sessionId;
        wx.setStorageSync(KEYS.RESULT_PREFIX + sessionId, result);
        wx.setStorageSync(KEYS.LATEST_SESSION, sessionId);
        self._finished = true;
        self.stopTimers();
        self.setData({ progress: 100, stageText: '分析完成' });
        wx.redirectTo({ url: '/pages/result/result?sessionId=' + sessionId });
      })
      .catch(function (err) {
        self.fail((err && err.message) || '分析失败，请重试');
      });
  },

  // 读本地照片为 base64 data URL；无照片（或读取失败）→ null，降级为纯问卷分析
  readImageAsBase64: function (filePath) {
    return new Promise(function (resolve) {
      if (!filePath) { resolve(null); return; }
      wx.getFileSystemManager().readFile({
        filePath: filePath,
        encoding: 'base64',
        success: function (res) {
          var base64 = res.data || '';
          // 服务端单张上限约 1.1MB base64（MAX_IMAGE_BASE64_CHARS=1500000），超限按无照片降级
          if (base64.length > 1400000) {
            resolve(null);
            return;
          }
          resolve('data:image/jpeg;base64,' + base64);
        },
        fail: function () { resolve(null); },
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
    this.stopTimers();
    this.setData({ error: message, stageText: '分析未完成' });
  },

  onRetry: function () {
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
