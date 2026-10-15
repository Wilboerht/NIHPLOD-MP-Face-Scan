// 用户中心（原「编辑资料」页升级）：头像/昵称/性别/生日 + 手机号/密码/收货地址入口 + 会员用量
// 资料读写直连主站 OAuth userinfo（Bearer）；手机号/密码/地址在子页面操作
var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var util = require('../../utils/util.js');
var account = require('../../utils/account.js');
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
    loading: true,
    // 基础资料
    nickname: '',
    avatarUrl: '',
    avatarChar: '我',
    displayAvatar: '',
    gender: null,
    genderLabel: '保密',
    birthday: '',
    phoneLabel: '—',
    passwordLabel: '—',
    addressLabel: '—',
    // 行内编辑态
    editingNickname: false,
    nicknameDraft: '',
    editingGender: false,
    editingBirthday: false,
    birthdayDraft: '',
    today: '',
    saving: false,
    vip: null,
  },

  onLoad: function () {
    this._saving = false;
    var user = auth.getUser() || {};
    var avatar = util.absUrl(user.avatarUrl || '', 'official');
    this.setData({
      nickname: user.name || '',
      avatarUrl: avatar,
      displayAvatar: avatar,
      avatarChar: this.firstChar(user.name),
      today: util.clientDateStr(new Date()),
    });
  },

  onShow: function () {
    // 首次进入/从子页面返回时刷新；行内编辑或保存中不打断（避免覆盖头像预览等中间态）
    if (this._saving || this.data.editingNickname || this.data.editingGender || this.data.editingBirthday) return;
    this.loadProfile();
    this.loadAddressLabel();
    this.checkVipUsage();
  },

  // 拉取主站资料（BFF 同源：GET /api/oauth/userinfo，按 token scope 裁剪返回）
  loadProfile: function () {
    var self = this;
    account.fetchProfile().then(function (p) {
      var displayAvatar = self.data.displayAvatar;
      if (p.avatarUrl) displayAvatar = p.avatarUrl;
      self.setData({
        loading: false,
        nickname: p.nickname || self.data.nickname,
        avatarUrl: p.avatarUrl || self.data.avatarUrl,
        displayAvatar: displayAvatar,
        avatarChar: self.firstChar(p.nickname || self.data.nickname),
        gender: p.gender,
        genderLabel: p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '保密',
        birthday: p.birthday,
        phoneLabel: p.phoneMasked || '未绑定',
        passwordLabel: p.hasPassword === true ? '已设置' : p.hasPassword === false ? '未设置' : '—',
      });
      // 服务端已设置生日（锁定）时关闭可能残留的编辑态（拉取慢于用户点击的竞态）
      if (p.birthday && self.data.editingBirthday) {
        self.setData({ editingBirthday: false });
      }
      if (p.nickname || p.avatarUrl) {
        account.updateLocalUser({ name: p.nickname, avatarUrl: p.avatarUrl });
      }
    }).catch(function () {
      self.setData({ loading: false }); // 拉取失败保持本地缓存展示
    });
  },

  // 收货地址行：已设置 / 未设置（轻量 count 查询，与 H5 口径一致）
  loadAddressLabel: function () {
    var self = this;
    request({
      base: 'official',
      url: '/api/oauth/addresses',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var list = res && res.data && res.data.addresses;
      if (Array.isArray(list)) self.setData({ addressLabel: list.length > 0 ? '已设置' : '未设置' });
    }).catch(function () {});
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

  // --------------------------------------------------------------------------
  // 资料保存（PUT 别名：wx.request method 白名单不含 PATCH）
  // --------------------------------------------------------------------------

  saveProfile: function (body, onOk) {
    var self = this;
    if (this._saving) return;
    this._saving = true;
    this.setData({ saving: true });
    function done() {
      self._saving = false;
      self.setData({ saving: false });
    }
    account.updateProfile(body).then(function () {
      done();
      if (onOk) onOk();
      wx.showToast({ title: '已保存', icon: 'success' });
    }).catch(function (err) {
      done();
      if (account.isInsufficientScope(err)) {
        account.relogin('登录状态需要更新，请重新登录');
        return;
      }
      // 生日已被主站锁定（如 H5/官网已设置）：收起编辑态并回源刷新（对齐 H5 saveBirthday 失败分支）
      if (err && err.data && err.data.error === 'birthday_locked') {
        self.setData({ editingBirthday: false });
        self.loadProfile();
        account.toast('生日已设置过，如需修改请联系客服');
        return;
      }
      account.toast((err && err.message) || '保存失败，请重试');
    });
  },

  // 头像：chooseAvatar → 上传 OSS → PUT userinfo
  onChooseAvatar: function (e) {
    var self = this;
    var path = e.detail.avatarUrl;
    if (!path || this._saving) return;
    this._saving = true;
    this.setData({ saving: true, displayAvatar: path });
    wx.showLoading({ title: '上传中…', mask: true });
    uploadImage(path, 'avatar').then(function (url) {
      return account.updateProfile({ avatar: url }).then(function () {
        wx.hideLoading();
        self._saving = false;
        self.setData({ saving: false, displayAvatar: url, avatarUrl: url });
        account.updateLocalUser({ avatarUrl: url });
        wx.showToast({ title: '已保存', icon: 'success' });
      });
    }).catch(function (err) {
      wx.hideLoading();
      self._saving = false;
      self.setData({ saving: false, displayAvatar: self.data.avatarUrl });
      if (account.isInsufficientScope(err)) {
        account.relogin('登录状态需要更新，请重新登录');
        return;
      }
      account.toast((err && err.message) || '头像上传失败，请重试');
    });
  },

  // 昵称：行内编辑
  onNicknameEdit: function () {
    this.setData({
      editingNickname: true,
      editingGender: false,
      editingBirthday: false,
      nicknameDraft: this.data.nickname || '',
    });
  },

  onNicknameInput: function (e) {
    this.setData({ nicknameDraft: e.detail.value });
  },

  onNicknameCancel: function () {
    this.setData({ editingNickname: false });
  },

  onNicknameSave: function () {
    var self = this;
    var name = (this.data.nicknameDraft || '').trim();
    if (!name) {
      account.toast('昵称不能为空');
      return;
    }
    if (name.length > 20) {
      account.toast('昵称最长 20 个字符');
      return;
    }
    if (name === this.data.nickname) {
      this.setData({ editingNickname: false });
      return;
    }
    this.saveProfile({ nickname: name }, function () {
      self.setData({ editingNickname: false, nickname: name, avatarChar: self.firstChar(name) });
      account.updateLocalUser({ name: name });
    });
  },

  // 性别：男/女/保密三态，点击即保存（与 H5 一致）
  onGenderToggle: function () {
    this.setData({
      editingGender: !this.data.editingGender,
      editingNickname: false,
      editingBirthday: false,
    });
  },

  onGenderPick: function (e) {
    var self = this;
    var value = e.currentTarget.dataset.value;
    var gender = value === 'male' || value === 'female' ? value : null;
    if (gender === this.data.gender) {
      this.setData({ editingGender: false });
      return;
    }
    this.saveProfile({ gender: gender }, function () {
      self.setData({
        editingGender: false,
        gender: gender,
        genderLabel: gender === 'male' ? '男' : gender === 'female' ? '女' : '保密',
      });
    });
  },

  onGenderCancel: function () {
    this.setData({ editingGender: false });
  },

  // 生日：仅未设置可设（主站设置后锁定）；picker mode=date 选择后保存
  onBirthdayEdit: function () {
    this.setData({
      editingBirthday: true,
      editingNickname: false,
      editingGender: false,
      birthdayDraft: this.data.birthday || '',
    });
  },

  onBirthdayChange: function (e) {
    this.setData({ birthdayDraft: e.detail.value });
  },

  onBirthdayCancel: function () {
    this.setData({ editingBirthday: false });
  },

  onBirthdaySave: function () {
    var self = this;
    var draft = this.data.birthdayDraft;
    if (!draft) {
      account.toast('请选择生日日期');
      return;
    }
    this.saveProfile({ birthday: draft }, function () {
      self.setData({ editingBirthday: false, birthday: draft });
    });
  },

  // --------------------------------------------------------------------------
  // 子页面入口与退出登录
  // --------------------------------------------------------------------------

  onGoPhone: function () {
    wx.navigateTo({ url: '/pages/phone-rebind/phone-rebind' });
  },

  onGoPassword: function () {
    wx.navigateTo({ url: '/pages/password/password' });
  },

  onGoAddresses: function () {
    wx.navigateTo({ url: '/pages/addresses/addresses' });
  },

  onGoArchive: function () {
    wx.navigateTo({ url: '/pages/archive/archive' });
  },

  onLogout: function () {
    wx.showModal({
      title: '退出登录',
      content: '退出后本地登录态将被清除，历史报告仍保留在账号中。',
      confirmText: '退出',
      confirmColor: '#b4553f',
      success: function (res) {
        if (!res.confirm) return;
        auth.logout();
        wx.showToast({ title: '已退出登录', icon: 'none' });
        setTimeout(function () {
          wx.reLaunch({ url: '/pages/index/index' });
        }, 600);
      },
    });
  },
});
