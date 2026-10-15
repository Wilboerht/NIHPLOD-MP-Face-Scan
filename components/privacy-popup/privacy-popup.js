Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    onAgree: function () {
      this.triggerEvent('agree');
    },
    onDisagree: function () {
      this.triggerEvent('disagree');
    },
    // 打开微信官方隐私协议页面（需基础库支持，失败时静默）
    onOpenContract: function () {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({ fail: function () {} });
      }
    },
    noop: function () {},
  },
});
