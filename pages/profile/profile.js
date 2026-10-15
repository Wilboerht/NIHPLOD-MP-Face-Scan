var config = require('../../config.js');
var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');
var uploadImage = require('../../utils/upload.js').uploadImage;

// 会员等级文案（对齐 H5 member-badges.ts；历史值 ADVANCED 服务端已归一为 GOLD，保留兜底）
var VIP_LEVEL_LABELS = {
  REGULAR: '普通会员',
  SILVER: '银卡会员',
  GOLD: '金卡会员',
  DIAMOND: '钻石会员',
  ADVANCED: '金卡会员',
};

Page({
  data: {
    nickname: '',        // 当前昵称
    avatarUrl: '',       // 当前头像 URL
    draftNickname: '',   // 编辑中的昵称
    newAvatarPath: '',   // chooseAvatar 拿到的临时文件路径（有值即代表头像有改动）
    displayAvatar: '',   // 展示用头像（新头像预览优先）
    avatarChar: '我',
    saving: false,
    vip: null, // 会员等级与测肤用量（test-limit 拉取成功后展示）
  },

  onLoad: function () {
    var user = auth.getUser() || {};
    var avatar = util.absUrl(user.avatarUrl || '', 'official');
    this.setData({
      nickname: user.name || '',
      avatarUrl: avatar,
      draftNickname: user.name || '',
      displayAvatar: avatar,
      avatarChar: this.firstChar(user.name),
    });
    this.checkVipUsage();
  },

  // 会员等级 + AI 测肤用量（对齐 H5 VipPanel loadSkinTestUsage 的展示口径）
  checkVipUsage: function () {
    var self = this;
    request({
      base: 'advisory',
      url: '/api/advisor/test-limit',
      method: 'GET',
      showError: false,
    }).then(function (data) {
      var usage = data && data.usage;
      if (!usage) return;
      var level = data.level || 'REGULAR';
      var totalUsed = usage.totalUsed || 0;
      var lifetimeLimit = usage.lifetimeLimit;
      var remaining = lifetimeLimit != null ? Math.max(0, lifetimeLimit - totalUsed) : null;
      self.setData({
        vip: {
          levelLabel: VIP_LEVEL_LABELS[level] || '普通会员',
          usageText: usage.unlimited
            ? '不限次'
            : '已用 ' + totalUsed + ' / 共 ' + (lifetimeLimit == null ? '-' : lifetimeLimit) + ' 次',
          todayText: usage.dailyLimit != null
            ? '今日已用 ' + (usage.todayUsed || 0) + '/' + usage.dailyLimit
            : '',
          exhaustedText: !usage.unlimited && remaining != null && remaining <= 0
            ? (level === 'SILVER'
                ? '测肤次数已用完，升级金卡会员可享不限次 AI 测肤'
                : '测肤次数已用完，升级银卡会员可获更多测肤次数')
            : '',
        },
      });
    }).catch(function () {
      // 用量加载失败静默：不展示卡片（H5 VipPanel 同口径）
    });
  },

  firstChar: function (name) {
    var n = (name || '').trim();
    return n ? n.charAt(0) : '我';
  },

  // 微信标准头像选择：<button open-type="chooseAvatar">
  onChooseAvatar: function (e) {
    var path = e.detail.avatarUrl;
    if (!path) return;
    this.setData({ newAvatarPath: path, displayAvatar: path });
  },

  // 微信标准昵称输入：<input type="nickname">
  onNicknameInput: function (e) {
    this.setData({ draftNickname: e.detail.value });
  },

  onCancel: function () {
    wx.navigateBack();
  },

  onSave: function () {
    var self = this;
    if (self.data.saving) return;

    var newNickname = (self.data.draftNickname || '').trim();
    var nicknameChanged = !!newNickname && newNickname !== self.data.nickname;
    var avatarChanged = !!self.data.newAvatarPath;

    // 空改动直接关闭，不发请求
    if (!nicknameChanged && !avatarChanged) {
      wx.navigateBack();
      return;
    }

    if (newNickname.length > 20) {
      wx.showToast({ title: '昵称最长 20 个字符', icon: 'none' });
      return;
    }

    self.setData({ saving: true });
    wx.showLoading({ title: '保存中…', mask: true });

    function done() {
      wx.hideLoading();
      self.setData({ saving: false });
    }

    // 1. 头像有改动 → 先上传拿 URL
    var avatarPromise = avatarChanged
      ? uploadImage(self.data.newAvatarPath, 'avatar')
      : Promise.resolve(null);

    avatarPromise
      .then(function (avatarUrl) {
        // 2. PATCH 官网 userinfo（只传改动字段；字段校验规则见官网 PATCH 契约）
        var body = {};
        if (nicknameChanged) body.nickname = newNickname;
        if (avatarUrl) body.avatar = avatarUrl;
        if (Object.keys(body).length === 0) return null;
        return request({
          base: 'official',
          url: '/api/oauth/userinfo',
          method: 'PATCH',
          data: body,
          showError: false,
        });
      })
      .then(function (res) {
        // 3. 同步本地 USER_INFO（登录时 user 字段为 name/avatarUrl，PATCH 响应为 nickname/avatar）
        var user = auth.getUser() || {};
        if (res && typeof res.nickname === 'string' && res.nickname) {
          user.name = res.nickname;
        } else if (nicknameChanged) {
          user.name = newNickname;
        }
        if (res && typeof res.avatar === 'string' && res.avatar) {
          user.avatarUrl = util.absUrl(res.avatar, 'official');
        }
        wx.setStorageSync(config.STORAGE_KEYS.USER_INFO, user);

        done();
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(function () { wx.navigateBack(); }, 600);
      })
      .catch(function (err) {
        done();
        // 403 birthday_locked / insufficient_scope 等透传服务端文案
        wx.showToast({ title: ((err && err.message) || '保存失败，请重试').slice(0, 28), icon: 'none', duration: 2500 });
      });
  },
});
