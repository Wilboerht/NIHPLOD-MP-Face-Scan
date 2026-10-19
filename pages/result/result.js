var config = require('../../config.js');
var request = require('../../utils/request.js').request;
var util = require('../../utils/util.js');
var poster = require('../../utils/poster.js');
var radar = require('../../utils/radar.js');
var ingredients = require('../../utils/ingredients.js');

var KEYS = config.STORAGE_KEYS;

// 雷达图固定维度顺序（与 utils/util.js DIMENSION_LABELS 对应）
var RADAR_DIM_ORDER = [
  'waterOil', 'skinTone', 'spots', 'wrinkles', 'uvDamage',
  'sensitivity', 'darkCircles', 'firmness', 'acne', 'radiance',
];
var RADAR_SIZE = 320; // 逻辑 px

// 渠道口令优先级：天猫 > 抖音 > 小红书
var AFFILIATE_ORDER = [
  { key: 'taobao', label: '天猫' },
  { key: 'douyin', label: '抖音' },
  { key: 'xiaohongshu', label: '小红书' },
];

// 展示用纯文本兜底：
// - 剥离 HTML 标签（服务端已用 DOMPurify 剥过全量标签，此处再兜历史缓存/脏数据一层）；
//   只匹配形如 <p>/</p>/<br/> 的标签，不会误伤「用量<1ml」这类数学比较
// - 解码服务端 DOMPurify 留下的常见实体（裸 < 会被存成 &lt;，纯文本直出会显示原文）
function plainText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

Page({
  data: {
    loading: true,
    loadError: '',
    sessionId: '',
    nickname: '',
    analyzedAt: '',
    skinTypeLabel: '',
    skinAge: null,
    overallScore: null,
    summary: '',
    hasRadar: false,
    dimensionList: [],   // [{label, score, gradeLabel, details}] 数据明细（雷达图下方保留）
    issues: [],          // consultantReport.issues
    strengths: [],
    zoneList: [],        // [{label, condition, advice}]
    conditions: [],      // faceAnalysis.skinConditions
    products: [],
    // 产品详情弹层（对齐 H5 ProductDetailModal）
    detailOpen: false,
    detailProduct: null,
  },

  onLoad: function (options) {
    this._rawResult = null;     // 原始结果（海报取 persona 等字段用）
    this._posterCanvas = null;  // 海报离屏 canvas 节点（懒初始化）
    this._posterBusy = false;

    var sessionId = (options && options.sessionId) || wx.getStorageSync(KEYS.LATEST_SESSION) || '';
    this.setData({ sessionId: sessionId });
    if (!sessionId) {
      this.setData({ loading: false, loadError: '缺少报告参数' });
      return;
    }
    var cached = wx.getStorageSync(KEYS.RESULT_PREFIX + sessionId);
    if (cached) {
      this.renderResult(cached);
      return;
    }
    this.fetchResult(sessionId);
  },

  // 本地无缓存时从服务端拉取（历史报告回看场景）
  fetchResult: function (sessionId) {
    var self = this;
    request({
      base: 'advisory',
      url: '/api/advisor/session/status?sessionId=' + encodeURIComponent(sessionId),
      method: 'GET',
      showError: false,
    }).then(function (res) {
      if (res.status === 'completed' && res.rawResult) {
        // 缓存失败（存储配额满）不应影响报告展示
        try { wx.setStorageSync(KEYS.RESULT_PREFIX + sessionId, res.rawResult); } catch (e) {}
        self.renderResult(res.rawResult);
      } else if (res.status === 'completed' && res.result) {
        self.renderResult(res.result);
      } else {
        self.setData({ loading: false, loadError: '报告不存在或尚未生成' });
      }
    }).catch(function (err) {
      self.setData({ loading: false, loadError: err.message || '报告加载失败' });
    });
  },

  // 把服务端结果（standardizedResult）转成视图数据
  renderResult: function (result) {
    var self = this;
    var r = result || {};
    self._rawResult = r;

    var face = r.faceAnalysis || {};
    var profile = r.skinProfile || {};
    var analysis = r.analysis || {};
    var consultant = r.consultantReport || {};

    var dimensionList = [];
    var dims = face.dimensions || {};
    Object.keys(dims).forEach(function (key) {
      var d = dims[key] || {};
      dimensionList.push({
        key: key,
        label: util.DIMENSION_LABELS[key] || key,
        score: typeof d.score === 'number' ? Math.round(d.score) : null,
        gradeLabel: util.GRADE_LABELS[d.grade] || '',
        details: d.details || '',
      });
    });

    // 雷达图数据：固定十维顺序，缺维度补 0
    var radarData = RADAR_DIM_ORDER.map(function (key) {
      var d = dims[key] || {};
      return {
        label: util.DIMENSION_LABELS[key] || key,
        score: typeof d.score === 'number' ? d.score : 0,
      };
    });
    var hasRadar = Object.keys(dims).length >= 3;

    var zoneList = [];
    var zones = face.zoneAnalysis || {};
    Object.keys(zones).forEach(function (key) {
      var z = zones[key] || {};
      if (!z.condition && !z.advice) return;
      zoneList.push({
        key: key,
        label: util.ZONE_LABELS[key] || key,
        condition: z.condition || '',
        advice: z.advice || '',
      });
    });

    var issues = (consultant.issues || []).map(function (i) {
      return {
        title: i.title || '',
        severityLabel: util.SEVERITY_LABELS[i.severity] || i.severity || '',
        observation: i.observation || '',
        directCauses: i.directCauses || '',
        skincarePlan: i.skincarePlan || '',
        lifestylePlan: i.lifestylePlan || '',
        medicalBoundary: i.medicalBoundary || '',
      };
    });

    var conditions = (face.skinConditions || []).map(function (c) {
      return {
        condition: c.condition || '',
        severityLabel: util.SEVERITY_LABELS[c.severity] || c.severity || '',
        area: c.area || '',
        description: c.description || '',
      };
    });

    var products = (r.products || []).map(self.decorateProduct);

    self.setData({
      loading: false,
      nickname: r.nickname || '',
      analyzedAt: util.formatTime(r.analyzedAt),
      skinTypeLabel: profile.typeLabel || (face.skinType && face.skinType.type) || '',
      skinAge: typeof profile.skinAge === 'number' ? profile.skinAge
        : (face.skinAge && face.skinAge.estimated) || null,
      overallScore: typeof face.overallScore === 'number' ? Math.round(face.overallScore) : null,
      summary: consultant.overview || analysis.summary || face.summary || '',
      hasRadar: hasRadar,
      dimensionList: dimensionList,
      issues: issues,
      strengths: consultant.strengths || [],
      zoneList: zoneList,
      conditions: conditions,
      products: products,
    }, function () {
      self._radarData = radarData;
      self.initRadar();
    });
  },

  // --------------------------------------------------------------------------
  // 任务 3：十维雷达图
  // --------------------------------------------------------------------------

  initRadar: function () {
    var self = this;
    if (!self.data.hasRadar || !self._radarData) return;
    wx.createSelectorQuery().in(self)
      .select('#radarCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        var node = res && res[0] && res[0].node;
        var width = res && res[0] && res[0].width;
        var height = res && res[0] && res[0].height;
        if (!node) return;
        var size = Math.min(width || RADAR_SIZE, height || RADAR_SIZE) || RADAR_SIZE;
        var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        radar.drawRadar(node, size, info.pixelRatio || 2, self._radarData, self.data.overallScore);
      });
  },

  // --------------------------------------------------------------------------
  // 任务 1：海报生成
  // --------------------------------------------------------------------------

  // 懒初始化离屏海报 canvas（1440×1920 缓冲，导出即输出尺寸，无需 dpr 缩放）
  initPosterCanvas: function () {
    var self = this;
    if (self._posterCanvas) return Promise.resolve(self._posterCanvas);
    return new Promise(function (resolve, reject) {
      wx.createSelectorQuery().in(self)
        .select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          var canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error('画布初始化失败'));
            return;
          }
          canvas.width = poster.CERT_WIDTH;
          canvas.height = poster.CERT_HEIGHT;
          self._posterCanvas = canvas;
          resolve(canvas);
        });
    });
  },

  // 组装海报数据：persona 从结果取（非法值 poster 模块兜底 guardian），
  // gender 取问卷 answers.gender，缺省回退面部分析的性别
  buildPosterInput: function () {
    var self = this;
    var r = self._rawResult || {};
    var answers = wx.getStorageSync(KEYS.ANSWERS) || {};
    var face = r.faceAnalysis || {};
    var gender = answers.gender || (face.gender && face.gender.value) || 'female';

    // 建议：与 H5 证书完全一致——取该派系 m7 建议前 2 条标题（内嵌于 utils/poster.js，
    // 不再用顾问报告长句：长句会被 fitText 截断，与 H5 观感不一致）
    var advice = poster.getPersonaAdvice(r.persona || 'guardian');

    // 百分位：公共服务，失败/无数据则不叠加
    var percentilePromise = typeof self.data.overallScore === 'number'
      ? request({
          base: 'advisory',
          url: '/api/advisor/score-percentile?score=' + self.data.overallScore,
          method: 'GET',
          showError: false,
        }).then(function (res) {
          return typeof res.percentile === 'number' ? res.percentile : null;
        }).catch(function () { return null; })
      : Promise.resolve(null);

    return percentilePromise.then(function (percentile) {
      return {
        persona: r.persona || 'guardian',
        gender: gender,
        nickname: self.data.nickname,
        score: self.data.overallScore,
        percentile: percentile,
        advice: advice,
      };
    });
  },

  // 保存证书入口：先选版式（标准版含二维码 / 分享版无二维码），与 H5 CertVariantPicker 交互一致
  onSavePoster: function () {
    var self = this;
    if (self._posterBusy) return;
    wx.showActionSheet({
      itemList: ['标准版（含评分与二维码）', '分享版（无二维码，适合小红书）'],
      success: function (res) {
        var variant = res.tapIndex === 1 ? 'noqr' : 'qr';
        self.generateAndSavePoster(variant);
      },
      fail: function () {}, // 用户取消：不生成
    });
  },

  generateAndSavePoster: function (variant) {
    var self = this;
    if (self._posterBusy) return;
    self._posterBusy = true;
    wx.showLoading({ title: '生成海报…', mask: true });

    self.initPosterCanvas()
      .then(function (canvas) {
        return self.buildPosterInput().then(function (input) {
          return poster.generatePoster(canvas, input, variant);
        });
      })
      .then(function (tempFilePath) {
        wx.hideLoading();
        self._posterBusy = false;
        self.saveToAlbum(tempFilePath);
      })
      .catch(function (err) {
        wx.hideLoading();
        self._posterBusy = false;
        wx.showToast({ title: ((err && err.message) || '海报生成失败').slice(0, 28), icon: 'none' });
      });
  },

  saveToAlbum: function (tempFilePath) {
    wx.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: function () {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: function (err) {
        var errMsg = (err && err.errMsg) || '';
        // 相册授权被拒 → 引导去设置页开启（scope.writePhotosAlbum 已在 app.json 声明）
        if (errMsg.indexOf('auth') > -1 || errMsg.indexOf('deny') > -1 || errMsg.indexOf('cancel') === -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '请开启「保存到相册」权限后重试',
            confirmText: '去开启',
            success: function (res) {
              if (res.confirm) wx.openSetting();
            },
          });
        }
      },
    });
  },

  // --------------------------------------------------------------------------
  // 任务 2：购买渠道
  // --------------------------------------------------------------------------

  // 产品卡片附加字段：
  // - 购买渠道：微信小店按钮（appid 未配置则隐藏）+ 天猫/抖音/小红书复制链接
  // - 详情弹层数据：主图+图库（相对路径补子站域名）、功效/成分/用法展示字段
  // 注意：H5 产品 affiliateLinks 字段（taobao/douyin/xiaohongshu）存的是 http(s) 链接，
  // 尚无文字口令字段；本期复制的是链接（复制后打开对应 App 可被识别为分享口令样式文本）
  decorateProduct: function (p) {
    var links = p.affiliateLinks || null;
    var copyText = '';
    var copyLabel = '';
    if (links) {
      for (var i = 0; i < AFFILIATE_ORDER.length; i++) {
        var ch = AFFILIATE_ORDER[i];
        if (links[ch.key]) {
          copyText = links[ch.key];
          copyLabel = ch.label;
          break;
        }
      }
    }
    // 主图 + 图库合并去重（相对路径按子站资产补 https://smart.nihplod.cn）
    var image = util.absUrl(p.image || '');
    var images = Array.isArray(p.images) ? p.images : [];
    var gallery = [];
    if (image) gallery.push(image);
    images.forEach(function (u) {
      var abs = util.absUrl(u || '');
      if (abs && gallery.indexOf(abs) === -1) gallery.push(abs);
    });
    // 成分名称规范化（与 H5 ingredient-glossary 同源映射，如「玻尿酸」→「玻尿酸（透明质酸钠）」）
    var keyIngredients = (Array.isArray(p.keyIngredients) ? p.keyIngredients : []).map(function (name) {
      return plainText(ingredients.getIngredientTitle(name));
    });
    // 社交证明（仅算法补足商品携带；门槛与 H5 卡片一致 ≥10%）
    var socialProofText = '';
    if (p.socialProof && p.socialProof.label &&
        typeof p.socialProof.affinity === 'number' && p.socialProof.affinity >= 10) {
      socialProofText = p.socialProof.label + ' · ' + p.socialProof.affinity + '%';
    }
    var benefits = Array.isArray(p.benefits) ? p.benefits : [];
    return Object.assign({}, p, {
      showShop: !!config.WECHAT_SHOP.appid, // 待小店后台获取 appid 后自动显示
      copyText: copyText,
      copyLabel: copyLabel,
      displayImage: image,
      galleryImages: gallery,
      reason: plainText(p.reason),
      descriptionText: plainText(p.description),
      howToUse: plainText(p.howToUse),
      benefitsText: benefits.map(plainText).filter(Boolean).join('、'),
      keyIngredients: keyIngredients,
      socialProofText: socialProofText,
      searchKeyword: p.category ? 'nihplod ' + p.category : '',
    });
  },

  // --------------------------------------------------------------------------
  // 产品详情弹层
  // --------------------------------------------------------------------------

  onOpenProduct: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var product = this.data.products[index];
    if (!product) return;
    this.setData({ detailOpen: true, detailProduct: product });
  },

  onCloseDetail: function () {
    this.setData({ detailOpen: false, detailProduct: null });
  },

  noop: function () {},

  // 详情弹层「去小红书了解更多」：小程序无法直接唤起小红书，复刻 H5 搜索词并引导手动搜索
  onCopySearchKeyword: function () {
    var product = this.data.detailProduct;
    var keyword = product && product.searchKeyword;
    if (!keyword) return;
    wx.setClipboardData({
      data: keyword,
      success: function () {
        wx.showToast({ title: '已复制搜索词，打开小红书搜索', icon: 'none' });
      },
    });
  },

  // 微信小店购买（占位：itemPath 待小店后台获取，如需携带商品 id 可在此拼接）
  onBuyShop: function () {
    if (!config.WECHAT_SHOP.appid) return;
    wx.navigateToMiniProgram({
      appId: config.WECHAT_SHOP.appid,
      path: config.WECHAT_SHOP.itemPath || undefined,
      fail: function () {
        wx.showToast({ title: '小店打开失败，请稍后重试', icon: 'none' });
      },
    });
  },

  // 复制渠道口令/链接（天猫/抖音/小红书）
  onCopyCommand: function (e) {
    var text = e.currentTarget.dataset.copy;
    var label = e.currentTarget.dataset.label;
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: function () {
        wx.showToast({ title: '口令已复制，打开' + label + '查看', icon: 'none' });
      },
    });
  },

  onBackHome: function () {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onShareAppMessage: function () {
    return {
      title: '我的肌肤得了 ' + (this.data.overallScore || '-') + ' 分，来测测你的！',
      path: '/pages/index/index',
    };
  },
});
