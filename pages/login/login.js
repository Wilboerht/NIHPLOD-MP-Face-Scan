var auth = require('../../utils/auth.js');

Page({
  data: {
    loading: false,
    needBinding: false,
  },

  onLogin: function () {
    var self = this;
    if (self.data.loading) return;
    self.setData({ loading: true });
    wx.showLoading({ title: '登录中…', mask: true });

    function done() {
      wx.hideLoading();
      self.setData({ loading: false });
    }

    auth.login().then(function (data) {
      done();
      if (data.needBinding) {
        // 新用户：切换到手机号一键绑定 UI（免短信，getPhoneNumber 直验）
        self.setData({ needBinding: true });
        return;
      }
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(function () {
        if (getCurrentPages().length > 1) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }, 800);
    }).catch(function (err) {
      done();
      wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' });
    });
  },

  // 手机号一键绑定（getPhoneNumber 按钮回调）
  onGetPhoneNumber: function (e) {
    var self = this;
    var code = e && e.detail && e.detail.code;
    if (!code) {
      // 用户拒绝授权：停留在当前页，可重新点击
      if (e && e.detail && e.detail.errMsg && e.detail.errMsg.indexOf('cancel') === -1) {
        wx.showToast({ title: '未获得手机号授权', icon: 'none' });
      }
      return;
    }
    if (self.data.loading) return;
    self.setData({ loading: true });
    wx.showLoading({ title: '绑定中…', mask: true });

    auth.bindPhoneAndLogin(code).then(function () {
      wx.hideLoading();
      self.setData({ loading: false });
      wx.showToast({ title: '注册成功', icon: 'success' });
      setTimeout(function () {
        if (getCurrentPages().length > 1) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }, 800);
    }).catch(function (err) {
      wx.hideLoading();
      self.setData({ loading: false });
      wx.showToast({ title: (err && err.message) || '绑定失败，请重试', icon: 'none' });
    });
  },
});
