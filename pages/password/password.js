// 密码管理：修改（旧密码验证）/ 首次设置（短信验证码）
// 成功后主站撤销全部 OAuth 会话 → 清本地态回登录页
var request = require('../../utils/request.js').request;
var account = require('../../utils/account.js');

Page({
  data: {
    loading: true,
    hasPassword: null,
    mode: 'change', // change（修改）| set（短信验证码设置）
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
    code: '',
    countdown: 0,
    sending: false,
    submitting: false,
  },

  onLoad: function () {
    var self = this;
    this._cdTimer = null;
    account.fetchProfile().then(function (p) {
      self.setData({
        loading: false,
        hasPassword: p.hasPassword,
        mode: p.hasPassword === false ? 'set' : 'change',
      });
    }).catch(function () {
      // 拉取失败按「修改」起步，靠 PASSWORD_NOT_SET 兜底切换（对齐 H5）
      self.setData({ loading: false });
    });
  },

  onUnload: function () {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  onOldInput: function (e) { this.setData({ oldPassword: e.detail.value || '' }); },
  onNewInput: function (e) { this.setData({ newPassword: e.detail.value || '' }); },
  onConfirmInput: function (e) { this.setData({ confirmPassword: e.detail.value || '' }); },
  onCodeInput: function (e) { this.setData({ code: String(e.detail.value || '').replace(/\D/g, '') }); },

  startCountdown: function () {
    var self = this;
    this.setData({ countdown: 60 });
    if (this._cdTimer) return;
    this._cdTimer = setInterval(function () {
      var c = self.data.countdown > 0 ? self.data.countdown - 1 : 0;
      self.setData({ countdown: c });
      if (c <= 0) {
        clearInterval(self._cdTimer);
        self._cdTimer = null;
      }
    }, 1000);
  },

  // 设置密码验证码：发送到当前账号手机号（主站按 token 解析，无需传参）
  onSendCode: function () {
    var self = this;
    if (this.data.sending || this.data.countdown > 0) return;
    this.setData({ sending: true });
    request({
      base: 'official',
      url: '/api/oauth/user/password/send-code',
      method: 'POST',
      data: {},
      showError: false,
    }).then(function (res) {
      self.setData({ sending: false });
      if (res && res.success) {
        self.startCountdown();
        wx.showToast({ title: '验证码已发送', icon: 'none' });
      } else {
        account.toast((res && res.error && res.error.message) || '验证码发送失败');
      }
    }).catch(function (err) {
      self.setData({ sending: false });
      if (account.isInsufficientScope(err)) {
        account.relogin('登录状态需要更新，请重新登录');
        return;
      }
      account.toast((err && err.message) || '网络异常，验证码发送失败，请稍后再试');
    });
  },

  // 业务错误兜底：PASSWORD_NOT_SET 切换到短信设置模式
  handleBizError: function (code, message) {
    if (code === 'PASSWORD_NOT_SET') {
      this.setData({ mode: 'set' });
      account.toast('该账号尚未设置密码，请通过短信验证码设置');
      return;
    }
    account.toast(message || '操作失败，请重试');
  },

  onSubmit: function () {
    var self = this;
    if (this.data.submitting) return;
    if (this.data.newPassword !== this.data.confirmPassword) {
      account.toast('两次输入的密码不一致');
      return;
    }
    var strengthError = account.validatePassword(this.data.newPassword);
    if (strengthError) {
      account.toast(strengthError);
      return;
    }
    if (this.data.mode === 'change') {
      if (!this.data.oldPassword) {
        account.toast('请输入旧密码');
        return;
      }
      if (this.data.newPassword === this.data.oldPassword) {
        account.toast('新密码不能与旧密码相同');
        return;
      }
    } else if (!/^\d{6}$/.test(this.data.code)) {
      account.toast('请输入 6 位数字验证码');
      return;
    }

    this.setData({ submitting: true });
    var reqOptions = this.data.mode === 'change'
      ? {
          url: '/api/oauth/user/password',
          method: 'PUT',
          data: {
            oldPassword: this.data.oldPassword,
            newPassword: this.data.newPassword,
            confirmPassword: this.data.confirmPassword,
          },
        }
      : {
          url: '/api/oauth/user/password/set',
          method: 'POST',
          data: {
            code: this.data.code,
            password: this.data.newPassword,
            confirmPassword: this.data.confirmPassword,
          },
        };
    reqOptions.base = 'official';
    reqOptions.showError = false;

    request(reqOptions).then(function (res) {
      self.setData({ submitting: false });
      if (res && res.success) {
        account.relogin('密码已更新，请重新登录');
      } else {
        self.handleBizError(res && res.error && res.error.code, res && res.error && res.error.message);
      }
    }).catch(function (err) {
      self.setData({ submitting: false });
      if (account.isInsufficientScope(err)) {
        account.relogin('登录状态需要更新，请重新登录');
        return;
      }
      var body = err && err.data;
      if (body && body.error && body.error.code) {
        self.handleBizError(body.error.code, body.error.message);
        return;
      }
      account.toast((err && err.message) || '网络异常，操作结果未知，请稍后重新登录确认');
    });
  },
});
