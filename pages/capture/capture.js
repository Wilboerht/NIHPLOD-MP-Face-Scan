var config = require('../../config.js');
var util = require('../../utils/util.js');

// ============================================================================
// 真机校准开关
// ============================================================================
var CALIBRATION = {
  // 前置摄像头原始帧相对用户视角是否镜像。
  // 镜像会导致「右转/左转」判定反向：真机实测方向反了就置 true。
  MIRROR_X: false,
  // VK 返回的关键点坐标系与画面方向不一致（宽高旋转 90°）时置 true，
  // 会在读取关键点时交换 x/y（发生在部分机型的横排 sensor 帧上）。
  SWAP_XY: false,
};

// 姿态判定阈值（语义移植自 H5 FaceCapture.tsx 的 HEAD_POSE_THRESHOLDS / CHIN_PITCH_*）
var POSE = {
  FRONT_MAX: 0.10,          // 正脸：|noseOffsetRatio| 上限
  TURN_MIN: 0.10,           // 左右转：noseOffsetRatio 越过 ±0.10 即到位
  CHIN_NOSE_MAX: 0.30,      // 抬头步骤要求水平方向基本居中（H5 chinNoseOffsetMax）
  CHIN_PITCH_DELTA: 0.15,   // 抬头判定：tiltRatio 需低于「正脸基准」该差值以上
  CHIN_FALLBACK: 0.22,      // 无基准时的绝对兜底阈值（低于平视波动下沿 0.25）
  STABLE_FRAMES: 5,         // 画面稳定：连续 N 帧姿态到位才触发自动拍摄
  FRAME_INTERVAL_MS: 150,   // 帧处理节流 ≈ 7fps
  MANUAL_BTN_DELAY_MS: 5000,// 每步 5s 未检测到人脸/姿态未到位 → 显示手动拍摄按钮
};

// ============================================================================
// VisionKit 106 关键点索引映射（mode:1）
// 官方未公布逐点索引图，以下按社区流传的 106 点布局整理，并把「眼睛」做成簇均值
// 以弱化单点索引误差。若真机校准发现偏移，改这里即可：
//   0-32  脸部轮廓（左 → 下巴 → 右），16 为下巴尖
//   33-37 左眉 / 38-42 右眉
//   43-52 左眼簇 / 53-62 右眼簇
//   63-69 鼻梁，70 鼻尖（待真机确认；若偏上可试 67-69）
// ============================================================================
// VK 106 点位索引（依据官方点位定义图校准，2026-10-14 真机校准）：
//   鼻尖=46，下巴尖=16（轮廓 0-32 的中点）
//   图像左侧眼簇：52-57 + 72/73/74（外眦52、内眦55、上缘53/72、下缘56/57/73）
//   图像右侧眼簇：58-63 + 75/76/105（内眦59、外眦61、上缘60/75、下缘62/63/76）
//   注意：图像左侧 = 用户本人右侧（前置镜像由 CALIBRATION.MIRROR_X 处理方向符号）
var VK_POINTS = {
  noseTip: 46,
  chin: 16,
  leftEyeIdx: [52, 53, 54, 55, 56, 57, 72, 73, 74],
  rightEyeIdx: [58, 59, 60, 61, 62, 63, 75, 76, 105],
};

// 步骤：front（正脸）→ right（右转）→ left（左转）→ chin（抬头）
var STEP_ORDER = ['front', 'right', 'left', 'chin'];
var STEP_CONFIG = {
  front: { label: '正脸', instruction: '请正对镜头' },
  right: { label: '右转', instruction: '请缓慢向右转头' },
  left: { label: '左转', instruction: '请缓慢向左转头' },
  chin: { label: '抬头', instruction: '请微微抬头露出下颚' },
};

// 基础库版本比较：v1 < v2 返回 -1
function compareVersion(v1, v2) {
  var a = String(v1 || '0').split('.');
  var b = String(v2 || '0').split('.');
  for (var i = 0; i < 3; i++) {
    var x = parseInt(a[i] || '0', 10);
    var y = parseInt(b[i] || '0', 10);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function getSDKVersion() {
  if (wx.getAppBaseInfo && wx.getAppBaseInfo().SDKVersion) return wx.getAppBaseInfo().SDKVersion;
  return wx.getSystemInfoSync().SDKVersion;
}

// 眼睛簇均值（比单点外眦更抗索引误差）；idxList 为索引数组
function clusterMean(points, idxList) {
  var sx = 0;
  var sy = 0;
  var n = 0;
  for (var k = 0; k < idxList.length; k++) {
    var p = points[idxList[k]];
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

Page({
  data: {
    skinStateOptions: util.SKIN_STATE_OPTIONS,
    skinState: 'bare',
    // 状态机
    steps: [],
    stepIndex: 0,
    instruction: '',
    statusHint: '',       // searching / adjusting / holding 的展示文案
    mode: 'auto',         // auto（VK 自动拍摄）| manual（降级：全手动）
    showManualBtn: false, // 5s 未到位或手动模式下显示快门
    capturing: false,
    cameraReady: true,
  },

  onLoad: function () {
    // 以下均为普通变量：帧数据与计数不走 setData，避免每帧触发热更新
    this._vk = null;              // VKSession 实例
    this._frameListener = null;   // CameraContext.onCameraFrame 监听
    this._cameraCtx = null;
    this._vkErrorCount = 0;
    this._lastFrameAt = 0;        // 节流时间戳
    this._busyFrame = false;      // 单帧处理中标记（detectFace 为同步调用，防御性保留）
    this._stableCount = 0;        // 连续姿态到位帧数
    this._lastTilt = null;        // 最近一帧 tiltRatio（front 拍摄瞬间写入基准）
    this._baselineTilt = null;    // 正脸拍摄瞬间的个人仰头基准（H5 baselineTiltRatioRef）
    this._photos = {};            // { front, right, left, chin } 临时文件路径
    this._manualTimer = null;     // 手动按钮延迟定时器
    this._uiStatus = '';          // 上一次 setData 的状态，用于 setData 去重
    this._capturing = false;      // takePhoto 在途标记（普通变量，避免 setData 竞态）
    this._inited = false;

    this.applyStep(0);
  },

  onReady: function () {
    this._cameraCtx = wx.createCameraContext();
    this.initVK();
  },

  onShow: function () {
    // 从后台返回：恢复帧监听（VK 存活时）
    if (this._inited && this._vk && this.data.mode === 'auto') {
      this.startFrameLoop();
    }
  },

  onHide: function () {
    this.stopFrameLoop();
  },

  onUnload: function () {
    // 防内存泄漏/后台耗电：停帧监听、注销 VK 事件、停 VK session、清定时器
    this.stopFrameLoop();
    if (this._vk) {
      try {
        if (this._onAnchors) this._vk.off('updateAnchors', this._onAnchors);
        if (this._onRemoveAnchors) this._vk.off('removeAnchors', this._onRemoveAnchors);
      } catch (e) {}
      try { this._vk.stop(); } catch (e) {}
      try { this._vk.destroy && this._vk.destroy(); } catch (e) {}
      this._vk = null;
    }
    if (this._manualTimer) {
      clearTimeout(this._manualTimer);
      this._manualTimer = null;
    }
  },

  // VisionKit 初始化与降级
  // --------------------------------------------------------------------------

  initVK: function () {
    var self = this;
    // 降级点 1：基础库 < 2.25.0 或无 createVKSession
    if (!wx.createVKSession || compareVersion(getSDKVersion(), '2.25.0') < 0) {
      self.downgrade('基础库版本过低，不支持人脸检测');
      return;
    }
    var session;
    try {
      // mode 2 才能用 detectFace（官方文档：detectFace 在 track.face.mode=2 时可用）
      session = wx.createVKSession({ track: { face: { mode: 2 } } });
    } catch (e) {
      // 降级点 2：createVKSession 抛异常（设备不支持等）
      self.downgrade('VisionKit 初始化失败');
      return;
    }
    if (!session) {
      self.downgrade('VisionKit 初始化失败');
      return;
    }
    try {
      session.start(function (err) {
        if (err) {
          // 降级点 3：session.start 报错（权限/硬件/算法包下载失败）
          self.downgrade('人脸检测启动失败');
          return;
        }
        self._vk = session;
        self._inited = true;
        // detectFace 是"输入端"（返回 undefined 属正常），结果经事件异步输出：
        // updateAnchors = 检测到/更新人脸，removeAnchors = 人脸离开画面
        // 绑定 this 并留存引用供 off 卸载
        self._onAnchors = self.onVkAnchors.bind(self);
        self._onRemoveAnchors = self.onVkRemoveAnchors.bind(self);
        session.on('updateAnchors', self._onAnchors);
        session.on('removeAnchors', self._onRemoveAnchors);
        self.startFrameLoop();
      });
    } catch (e) {
      self.downgrade('人脸检测启动失败');
    }
  },

  // 整页降级为手动模式：引导文案不变，直接给快门按钮，不再依赖 VK
  downgrade: function (reason) {
    console.warn('[capture] 降级为手动模式:', reason);
    this.stopFrameLoop();
    if (this._vk) {
      try { this._vk.stop(); } catch (e) {}
      this._vk = null;
    }
    this.setData({ mode: 'manual', showManualBtn: true, statusHint: '' });
  },

  // --------------------------------------------------------------------------
  // 帧循环：onCameraFrame 取帧 → 节流 → detectFace → 姿态评估
  // --------------------------------------------------------------------------

  startFrameLoop: function () {
    var self = this;
    if (self._frameListener || !self._cameraCtx) return;
    self._frameListener = self._cameraCtx.onCameraFrame(function (frame) {
      var now = Date.now();
      if (now - self._lastFrameAt < POSE.FRAME_INTERVAL_MS) return; // 节流
      self._lastFrameAt = now;
      self.processFrame(frame);
    });
    if (!self._frameListener) {
      self.downgrade('相机帧监听不可用');
      return;
    }
    self._frameListener.start({
      fail: function () {
        self._frameListener = null;
        self.downgrade('相机帧监听启动失败');
      },
    });
  },

  stopFrameLoop: function () {
    if (this._frameListener) {
      try { this._frameListener.stop(); } catch (e) {}
      this._frameListener = null;
    }
  },

  processFrame: function (frame) {
    if (this._busyFrame || this._capturing || !this._vk) return;
    if (!frame || !frame.data || !frame.width || !frame.height) return;
    this._busyFrame = true;
    try {
      // detectFace 为"输入端"：返回 undefined 属正常，识别结果经 session.on('updateAnchors') 输出
      // sourceType=0 表示连续视频帧（1 是随机图片）；frameBuffer 为 RGBA 原始像素
      this._vk.detectFace({
        frameBuffer: frame.data,
        width: frame.width,
        height: frame.height,
        scoreThreshold: 0.5,
        sourceType: 0,
      });
      this._vkErrorCount = 0;
    } catch (e) {
      // 降级点 4：detectFace 持续报错 → 手动模式
      this._vkErrorCount += 1;
      console.warn('[capture] detectFace error:', e);
      if (this._vkErrorCount >= 3) this.downgrade('人脸检测异常');
    }
    this._busyFrame = false;
  },

  // VK 检测结果输出端：updateAnchors 事件（每帧触发，含 106 关键点）
  onVkAnchors: function (anchors) {
    if (this._capturing || !this._inited) return;
    var list = Array.isArray(anchors) ? anchors : [anchors];
    var faces = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      // VKFaceAnchor 兼容：points / landmarks 两种字段名
      var pts = a && (a.points || a.landmarks);
      if (pts && pts.length >= 63) faces.push({ points: pts });
    }
    if (!faces.length) return;
    this.handleFaces(faces);
  },

  // 人脸离开画面
  onVkRemoveAnchors: function () {
    this._stableCount = 0;
    this.updateStatusHint('searching');
  },

  handleFaces: function (faces) {
    var step = STEP_ORDER[this.data.stepIndex];
    if (!faces.length) {
      this._stableCount = 0;
      this.updateStatusHint('searching');
      return;
    }

    var metrics = this.computeMetrics(faces[0]);
    if (!metrics) {
      this._stableCount = 0;
      this.updateStatusHint('searching');
      return;
    }
    this._lastTilt = metrics.tilt;

    if (this.poseOk(step, metrics)) {
      this._stableCount += 1;
      this.updateStatusHint('holding');
      if (this._stableCount >= POSE.STABLE_FRAMES) {
        this.doCapture(); // 自动拍摄
      }
    } else {
      this._stableCount = 0; // 任务口径：要求「连续」N 帧，中断即清零
      this.updateStatusHint('adjusting');
    }
  },

  // 关键点 → 姿态指标（noseOffsetRatio / tiltRatio）
  computeMetrics: function (face) {
    var raw = face && face.points;
    if (!raw || raw.length < 63) return null;

    // 坐标系校准开关
    var points = raw;
    if (CALIBRATION.SWAP_XY) {
      points = raw.map(function (p) { return { x: p.y, y: p.x }; });
    }

    var nose = points[VK_POINTS.noseTip];
    var chin = points[VK_POINTS.chin];
    var eyeL = clusterMean(points, VK_POINTS.leftEyeIdx);
    var eyeR = clusterMean(points, VK_POINTS.rightEyeIdx);
    if (!nose || !chin || !eyeL || !eyeR) return null;

    var eyesCenterX = (eyeL.x + eyeR.x) / 2;
    var eyesCenterY = (eyeL.y + eyeR.y) / 2;
    var eyeDistance = Math.abs(eyeR.x - eyeL.x);
    if (eyeDistance <= 0) return null;

    // 鼻尖相对双眼中点的水平偏移比（前置镜像时反转符号，使「用户视角的右」为正）
    var offset = (nose.x - eyesCenterX) / eyeDistance;
    if (CALIBRATION.MIRROR_X) offset = -offset;

    // 仰头指标：鼻尖到双眼连线垂距 / 双眼到下巴垂距（越小越仰头，与 H5 calculateTiltRatio 同构）
    var eyesToChinY = chin.y - eyesCenterY;
    var tilt = eyesToChinY !== 0 ? (nose.y - eyesCenterY) / eyesToChinY : 0.5;

    return { offset: offset, tilt: tilt };
  },

  // 当前步骤的姿态到位判定（口径见 POSE 注释）
  poseOk: function (step, m) {
    var a = Math.abs(m.offset);
    if (step === 'front') return a < POSE.FRONT_MAX;
    if (step === 'right') return m.offset > POSE.TURN_MIN;
    if (step === 'left') return m.offset < -POSE.TURN_MIN;
    if (step === 'chin') {
      var threshold = this._baselineTilt !== null
        ? this._baselineTilt - POSE.CHIN_PITCH_DELTA
        : POSE.CHIN_FALLBACK;
      return m.tilt < threshold && a < POSE.CHIN_NOSE_MAX;
    }
    return false;
  },

  // setData 去重：状态不变不触发渲染
  updateStatusHint: function (status) {
    if (status === this._uiStatus) return;
    this._uiStatus = status;
    var hint = '';
    if (status === 'searching') hint = '未检测到人脸，请把脸放入框内';
    else if (status === 'adjusting') hint = STEP_CONFIG[STEP_ORDER[this.data.stepIndex]].instruction;
    else if (status === 'holding') hint = '很好，保持姿势…';
    this.setData({ statusHint: hint });
  },

  // --------------------------------------------------------------------------
  // 状态机：步骤流转
  // --------------------------------------------------------------------------

  applyStep: function (index) {
    var order = STEP_ORDER;
    var steps = order.map(function (key, i) {
      return { key: key, label: STEP_CONFIG[key].label, done: i < index, active: i === index };
    });
    this._stableCount = 0;
    this._uiStatus = '';
    this.setData({
      steps: steps,
      stepIndex: index,
      instruction: STEP_CONFIG[order[index]].instruction,
      statusHint: '',
      showManualBtn: this.data.mode === 'manual',
    });
    this.startManualTimer();
  },

  // 每步 5s 未检测到人脸/姿态未到位 → 显示手动拍摄按钮（无论 VK 是否可用）
  startManualTimer: function () {
    var self = this;
    if (self._manualTimer) clearTimeout(self._manualTimer);
    self._manualTimer = setTimeout(function () {
      self._manualTimer = null;
      self.setData({ showManualBtn: true });
    }, POSE.MANUAL_BTN_DELAY_MS);
  },

  // --------------------------------------------------------------------------
  // 拍摄（自动/手动共用）
  // --------------------------------------------------------------------------

  onShutter: function () {
    this.doCapture();
  },

  doCapture: function () {
    var self = this;
    if (self._capturing || !self._cameraCtx) return;
    self._capturing = true;
    self.setData({ capturing: true });

    self._cameraCtx.takePhoto({
      quality: 'high',
      success: function (res) {
        self.compressPhoto(res.tempImagePath, function (path) {
          self.onStepPhoto(path);
        });
      },
      fail: function () {
        self._capturing = false;
        self.setData({ capturing: false });
        wx.showToast({ title: '拍摄失败，请重试', icon: 'none' });
      },
    });
  },

  compressPhoto: function (tempImagePath, cb) {
    wx.compressImage({
      src: tempImagePath,
      quality: 60,
      success: function (res) { cb(res.tempFilePath); },
      fail: function () { cb(tempImagePath); }, // 压缩失败用原图
    });
  },

  onStepPhoto: function (path) {
    var step = STEP_ORDER[this.data.stepIndex];
    this._photos[step] = path;
    // 正脸拍摄瞬间记录个人仰头基准（H5 baselineTiltRatioRef 语义）
    if (step === 'front' && this._lastTilt !== null) {
      this._baselineTilt = this._lastTilt;
    }

    wx.vibrateShort({ type: 'light', fail: function () {} });

    var next = this.data.stepIndex + 1;
    this._capturing = false;
    if (next < STEP_ORDER.length) {
      this.setData({ capturing: false });
      this.applyStep(next);
    } else {
      this.finish();
    }
  },

  finish: function () {
    var photos = this._photos;
    // 缺照片兜底（理论上每步都有，防御性检查）
    for (var i = 0; i < STEP_ORDER.length; i++) {
      if (!photos[STEP_ORDER[i]]) {
        this.setData({ capturing: false });
        wx.showToast({ title: '拍摄数据不完整，请重新拍摄', icon: 'none' });
        this.applyStep(i);
        return;
      }
    }
    // front 仍写 FACE_IMAGE_PATH（analyzing.js 只发正脸给 face-analyze，不变）；
    // 另外 3 张本地留存，供结果页展示用
    wx.setStorageSync(config.STORAGE_KEYS.FACE_IMAGE_PATH, photos.front);
    wx.setStorageSync(config.STORAGE_KEYS.FACE_IMAGE_SIDE_PATHS, {
      right: photos.right,
      left: photos.left,
      chin: photos.chin,
    });
    wx.setStorageSync(config.STORAGE_KEYS.SKIN_STATE, this.data.skinState);
    wx.navigateTo({ url: '/pages/analyzing/analyzing' });
  },

  // --------------------------------------------------------------------------
  // 相机与 UI 事件
  // --------------------------------------------------------------------------

  onInitDone: function () {
    // camera 初始化完成回调
  },

  onCameraError: function (e) {
    var detail = (e && e.detail) || {};
    var errMsg = detail.errMsg || '';
    this.setData({ cameraReady: false });
    if (errMsg.indexOf('auth') > -1 || errMsg.indexOf('authorize') > -1) {
      wx.showModal({
        title: '需要摄像头权限',
        content: '请开启摄像头权限后拍摄面部照片进行肤质分析',
        confirmText: '去开启',
        success: function (res) {
          if (res.confirm) wx.openSetting();
        },
      });
    } else {
      wx.showToast({ title: '相机启动失败，请重试', icon: 'none' });
    }
  },

  onSkinStateTap: function (e) {
    this.setData({ skinState: e.currentTarget.dataset.value });
  },
});
