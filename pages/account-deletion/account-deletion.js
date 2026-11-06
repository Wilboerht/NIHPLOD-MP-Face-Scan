// 账号注销（主站 OAuth /api/oauth/account/deletion）：
// GET 查询进行中申请 / POST 提交（冷静期）/ DELETE 撤回
var request = require('../../utils/request.js').request;
var auth = require('../../utils/auth.js');
var account = require('../../utils/account.js');
var util = require('../../utils/util.js');

var SERVICE_EMAIL = 'service@nihplod.cn';

Page({
  data: {
    loading: true,
    loggedIn: false,
    request: null,
    warnings: [],
    reason: '',
    smsCode: '',
    codeSending: false,
    codeCountdown: 0,
    codeSent: false,
    confirmed: false,
    submitting: false,
    error: '',
    email: SERVICE_EMAIL,
  },

  onLoad: function () {
    this._loaded = false;
    this._submitting = false;
    this._cdTimer = null;
    this.check();
  },

  onUnload: function () {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  onShow: function () {
    // 从登录页返回后重新检查；已加载过则不重复拉取
    if (this._loaded) return;
    this.check();
  },

  check: function () {
    if (!auth.isLoggedIn()) {
      this._loaded = false; // 登录返回后 onShow 需要重新检查
      this.setData({ loading: false, loggedIn: false });
      return;
    }
    this._loaded = true;
    this.load();
  },

  load: function () {
    var self = this;
    self.setData({ loading: true, error: '' });
    request({
      base: 'official',
      url: '/api/oauth/account/deletion',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var data = (res && res.data) || {};
      self.setData({
        loading: false,
        loggedIn: true,
        request: data.request ? self.decorate(data.request) : null,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      });
    }).catch(function (err) {
      if (err && err.statusCode === 401) {
        self._loaded = false;
        self.setData({ loading: false, loggedIn: false });
        return;
      }
      self._loaded = false;
      self.setData({ loading: false, error: (err && err.message) || '加载失败，请稍后重试' });
    });
  },

  decorate: function (item) {
    return Object.assign({}, item, {
      scheduledText: util.formatTime(item.scheduledAt),
    });
  },

  startCodeCountdown: function () {
    var self = this;
    if (this._cdTimer) clearInterval(this._cdTimer);
    this.setData({ codeCountdown: 60 });
    this._cdTimer = setInterval(function () {
      var c = self.data.codeCountdown > 0 ? self.data.codeCountdown - 1 : 0;
      self.setData({ codeCountdown: c });
      if (c <= 0) {
        clearInterval(self._cdTimer);
        self._cdTimer = null;
      }
    }, 1000);
  },

  stopCodeCountdown: function () {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
    this.setData({ codeCountdown: 0 });
  },

  onSmsCodeInput: function (e) {
    this.setData({
      smsCode: String(e.detail.value || '').replace(/\D/g, '').slice(0, 6),
      error: '',
    });
  },

  onSendCode: function () {
    var self = this;
    if (this.data.codeSending || this.data.codeCountdown > 0) return;
    this.setData({ codeSending: true, error: '' });
    request({
      base: 'official',
      url: '/api/oauth/account/deletion/send-code',
      method: 'POST',
      data: {},
      showError: false,
    }).then(function () {
      self.setData({ codeSending: false, codeSent: true });
      self.startCodeCountdown();
      wx.showToast({ title: '验证码已发送', icon: 'none' });
    }).catch(function (err) {
      self.setData({ codeSending: false, codeSent: false });
      account.toast((err && err.message) || '验证码发送失败，请稍后重试');
    });
  },

  onReasonInput: function (e) {
    this.setData({ reason: e.detail.value || '', error: '' });
  },

  onConfirmChange: function (e) {
    this.setData({ confirmed: (e.detail.value || []).length > 0 });
  },

  submit: function () {
    var self = this;
    if (this._submitting) return;
    if (!this.data.confirmed) {
      wx.showToast({ title: '请先勾选确认', icon: 'none' });
      return;
    }
    if (!/^\d{6}$/.test(this.data.smsCode)) {
      wx.showToast({ title: '请输入 6 位短信验证码', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认申请注销',
      content: '冷静期内可随时撤回；生效后账号不可恢复，确定继续吗？',
      confirmText: '继续申请',
      confirmColor: '#c25450',
      success: function (res) {
        if (res.confirm) self.doSubmit();
      },
    });
  },

  doSubmit: function () {
    var self = this;
    if (this._submitting) return;
    this._submitting = true;
    this.setData({ submitting: true, error: '' });
    var reason = (this.data.reason || '').trim();
    var payload = { smsCode: this.data.smsCode };
    if (reason) payload.reason = reason;
    request({
      base: 'official',
      url: '/api/oauth/account/deletion',
      method: 'POST',
      data: payload,
      showError: false,
    }).then(function (res) {
      self._submitting = false;
      var data = (res && res.data) || {};
      self.stopCodeCountdown();
      self.setData({
        submitting: false,
        request: data.request ? self.decorate(data.request) : null,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        confirmed: false,
        reason: '',
        smsCode: '',
        codeSent: false,
      });
      wx.showToast({ title: '已提交注销申请', icon: 'success' });
    }).catch(function (err) {
      self._submitting = false;
      self.setData({ submitting: false, error: (err && err.message) || '提交失败，请稍后重试' });
    });
  },

  withdraw: function () {
    var self = this;
    if (this._submitting) return;
    wx.showModal({
      title: '撤回注销申请',
      content: '撤回后账号恢复正常使用，确定撤回吗？',
      success: function (res) {
        if (res.confirm) self.doWithdraw();
      },
    });
  },

  doWithdraw: function () {
    var self = this;
    if (this._submitting) return;
    this._submitting = true;
    this.setData({ submitting: true, error: '' });
    request({
      base: 'official',
      url: '/api/oauth/account/deletion',
      method: 'DELETE',
      showError: false,
    }).then(function () {
      self._submitting = false;
      self.setData({ submitting: false, warnings: [] });
      wx.showToast({ title: '已撤回注销申请', icon: 'success' });
      self.load();
    }).catch(function (err) {
      self._submitting = false;
      self.setData({ submitting: false, error: (err && err.message) || '撤回失败，请稍后重试' });
    });
  },

  goLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onOpenPrivacy: function () {
    if (wx.openPrivacyContract) {
      wx.openPrivacyContract({
        fail: function () {
          wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
        },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
  },

  copyEmail: function () {
    wx.setClipboardData({
      data: this.data.email,
      success: function () {
        wx.showToast({ title: '邮箱已复制', icon: 'none' });
      },
    });
  },
});
