// 换绑手机号：双向短信验证（当前号验证身份 + 新号验证归属）
// 成功后主站撤销全部 OAuth 会话 → 清本地态回登录页
var request = require('../../utils/request.js').request;
var account = require('../../utils/account.js');

Page({
  data: {
    loading: true,
    loadError: false,
    phoneLabel: '',
    hasRealPhone: false,
    newPhone: '',
    currentCode: '',
    newCode: '',
    cdCurrent: 0,
    cdNew: 0,
    sending: '',
    submitting: false,
  },

  onLoad: function () {
    this._cdTimer = null;
    this.load();
  },

  load: function () {
    var self = this;
    self.setData({ loading: true, loadError: false });
    account.fetchProfile().then(function (p) {
      self.setData({
        loading: false,
        phoneLabel: p.phoneMasked || '未绑定',
        hasRealPhone: !!p.phoneMasked,
      });
    }).catch(function () {
      // 拉取失败未知是否已绑定：不进入表单（避免漏掉当前手机验证码），给重试
      self.setData({ loading: false, loadError: true });
    });
  },

  onRetry: function () {
    this.load();
  },

  onUnload: function () {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  startCountdown: function (target) {
    var self = this;
    var patch = {};
    if (target === 'current') patch.cdCurrent = 60;
    else patch.cdNew = 60;
    this.setData(patch);
    if (this._cdTimer) return; // 已有定时器在跑（两路倒计时共用）
    this._cdTimer = setInterval(function () {
      var c = self.data.cdCurrent > 0 ? self.data.cdCurrent - 1 : 0;
      var n = self.data.cdNew > 0 ? self.data.cdNew - 1 : 0;
      self.setData({ cdCurrent: c, cdNew: n });
      if (c <= 0 && n <= 0) {
        clearInterval(self._cdTimer);
        self._cdTimer = null;
      }
    }, 1000);
  },

  onNewPhoneInput: function (e) {
    this.setData({ newPhone: String(e.detail.value || '').replace(/\D/g, '') });
  },

  onCurrentCodeInput: function (e) {
    this.setData({ currentCode: String(e.detail.value || '').replace(/\D/g, '') });
  },

  onNewCodeInput: function (e) {
    this.setData({ newCode: String(e.detail.value || '').replace(/\D/g, '') });
  },

  // 发送验证码：target=current 发到当前手机（验证身份）；target=new 发到新手机（验证归属）
  onSendCode: function (e) {
    var self = this;
    var target = e.currentTarget.dataset.target;
    if (this.data.sending) return;
    if (target === 'current' && (this.data.cdCurrent > 0 || !this.data.hasRealPhone)) return;
    if (target === 'new' && this.data.cdNew > 0) return;
    var data = { target: target };
    if (target === 'new') {
      if (!/^1[3-9]\d{9}$/.test(this.data.newPhone)) {
        account.toast('请输入正确的新手机号');
        return;
      }
      data.newPhone = this.data.newPhone;
    }
    this.setData({ sending: target });
    function done() {
      self.setData({ sending: '' });
    }
    request({
      base: 'official',
      url: '/api/oauth/phone/send-code',
      method: 'POST',
      data: data,
      showError: false,
    }).then(function (res) {
      done();
      if (res && res.success) {
        self.startCountdown(target);
        wx.showToast({ title: '验证码已发送', icon: 'none' });
      } else {
        account.toast((res && res.error && res.error.message) || '验证码发送失败');
      }
    }).catch(function (err) {
      done();
      account.toast((err && err.message) || '网络异常，验证码发送失败，请稍后再试');
    });
  },

  onSubmit: function () {
    var self = this;
    if (this.data.submitting) return;
    if (!/^1[3-9]\d{9}$/.test(this.data.newPhone)) {
      account.toast('请输入正确的新手机号');
      return;
    }
    if (this.data.hasRealPhone && !/^\d{6}$/.test(this.data.currentCode)) {
      account.toast('请输入 6 位当前手机验证码');
      return;
    }
    if (!/^\d{6}$/.test(this.data.newCode)) {
      account.toast('请输入 6 位新手机验证码');
      return;
    }
    var data = this.data.hasRealPhone
      ? { newPhone: this.data.newPhone, currentCode: this.data.currentCode, newCode: this.data.newCode }
      : { newPhone: this.data.newPhone, newCode: this.data.newCode };
    this.setData({ submitting: true });
    request({
      base: 'official',
      url: '/api/oauth/phone',
      method: 'PUT',
      data: data,
      showError: false,
    }).then(function (res) {
      self.setData({ submitting: false });
      if (res && res.success) {
        account.relogin('手机号已更新，请重新登录');
      } else {
        account.toast((res && res.error && res.error.message) || '换绑失败，请重试');
      }
    }).catch(function (err) {
      self.setData({ submitting: false });
      account.toast((err && err.message) || '网络异常，换绑结果未知，请稍后重新登录确认');
    });
  },
});
