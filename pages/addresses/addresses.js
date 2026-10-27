// 收货地址簿（积分兑礼寄送用）：列表 / 新增 / 编辑 / 删除
// 直连主站 /api/oauth/addresses（Bearer；编辑用 PUT 别名，wx.request 不支持 PATCH）
var request = require('../../utils/request.js').request;
var account = require('../../utils/account.js');

var MAX_ADDRESSES = 20;

Page({
  data: {
    loading: true,
    loadError: false,
    list: [],
    view: 'list', // list | form
    editingId: '',
    regionArray: [],
    form: {
      recipient: '',
      phone: '',
      region: '',
      detail: '',
      isDefault: false,
    },
    confirmingDeleteId: '',
    saving: false,
    deleting: false,
  },

  onLoad: function () {
    this._saving = false;
    this._deleting = false;
    this.load();
  },

  load: function () {
    var self = this;
    self.setData({ loadError: false });
    request({
      base: 'official',
      url: '/api/oauth/addresses',
      method: 'GET',
      showError: false,
    }).then(function (res) {
      var raw = res && res.data && res.data.addresses;
      var list = Array.isArray(raw) ? raw : [];
      self.setData({ loading: false, list: list });
    }).catch(function () {
      self.setData({ loading: false, loadError: true });
    });
  },

  onRetry: function () {
    this.setData({ loading: true });
    this.load();
  },

  // --------------------------------------------------------------------------
  // 表单视图
  // --------------------------------------------------------------------------

  resetForm: function () {
    this.setData({
      editingId: '',
      regionArray: [],
      form: { recipient: '', phone: '', region: '', detail: '', isDefault: false },
    });
  },

  onAdd: function () {
    if (this.data.list.length >= MAX_ADDRESSES) {
      account.toast('最多保存 ' + MAX_ADDRESSES + ' 个收货地址');
      return;
    }
    this.resetForm();
    this.setData({ view: 'form' }, this.afterShowForm);
  },

  onEdit: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var item = this.data.list[index];
    if (!item) return;
    this.setData({
      editingId: item.id,
      regionArray: item.region ? item.region.split(' ') : [],
      form: {
        recipient: item.recipient || '',
        phone: item.phone || '',
        region: item.region || '',
        detail: item.detail || '',
        isDefault: !!item.isDefault,
      },
      view: 'form',
    }, this.afterShowForm);
  },

  afterShowForm: function () {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    if (wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: '地址尚未保存，确定离开吗？' });
    }
  },

  leaveForm: function () {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    this.setData({ view: 'list' }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    });
  },

  onFormCancel: function () {
    this.resetForm();
    this.leaveForm();
  },

  onRecipientInput: function (e) {
    this.setData({ 'form.recipient': e.detail.value || '' });
  },

  onPhoneInput: function (e) {
    this.setData({ 'form.phone': String(e.detail.value || '').replace(/\D/g, '') });
  },

  onRegionChange: function (e) {
    var arr = e.detail.value || [];
    this.setData({
      regionArray: arr,
      'form.region': arr.join(' '),
    });
  },

  onDetailInput: function (e) {
    this.setData({ 'form.detail': e.detail.value || '' });
  },

  onDefaultChange: function (e) {
    this.setData({ 'form.isDefault': !!e.detail.value });
  },

  onFormSave: function () {
    var self = this;
    if (this._saving) return;
    var form = this.data.form;
    var recipient = (form.recipient || '').trim();
    var phone = form.phone || '';
    var region = (form.region || '').trim();
    var detail = (form.detail || '').trim();
    if (!recipient) {
      account.toast('请填写收货人姓名');
      return;
    }
    if (recipient.length > 20) {
      account.toast('收货人姓名过长');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      account.toast('请输入正确的手机号');
      return;
    }
    if (!region) {
      account.toast('请选择省市区');
      return;
    }
    if (!detail) {
      account.toast('请填写详细地址');
      return;
    }
    if (detail.length > 120) {
      account.toast('详细地址过长');
      return;
    }
    var body = {
      recipient: recipient,
      phone: phone,
      region: region,
      detail: detail,
      isDefault: !!form.isDefault,
    };
    var editingId = this.data.editingId;
    this._saving = true;
    this.setData({ saving: true });
    request({
      base: 'official',
      url: '/api/oauth/addresses' + (editingId ? '/' + editingId : ''),
      method: editingId ? 'PUT' : 'POST',
      data: body,
      showError: false,
    }).then(function (res) {
      self._saving = false;
      self.setData({ saving: false });
      if (res && res.success) {
        wx.showToast({ title: editingId ? '地址已更新' : '地址已添加', icon: 'success' });
        self.resetForm();
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
        self.setData({ view: 'list', loading: true }, function () {
          wx.pageScrollTo({ scrollTop: 0, duration: 0 });
        });
        self.load();
      } else {
        account.toast((res && res.error && res.error.message) || '保存失败，请稍后重试');
      }
    }).catch(function (err) {
      self._saving = false;
      self.setData({ saving: false });
      account.toast((err && err.message) || '网络异常，保存失败，请稍后重试');
    });
  },

  // --------------------------------------------------------------------------
  // 删除（两步行内确认）
  // --------------------------------------------------------------------------

  onDeleteTap: function (e) {
    this.setData({ confirmingDeleteId: e.currentTarget.dataset.id });
  },

  onDeleteCancel: function () {
    this.setData({ confirmingDeleteId: '' });
  },

  onDeleteConfirm: function (e) {
    var self = this;
    var id = e.currentTarget.dataset.id;
    if (this._deleting || !id) return;
    this._deleting = true;
    this.setData({ deleting: true });
    request({
      base: 'official',
      url: '/api/oauth/addresses/' + id,
      method: 'DELETE',
      showError: false,
    }).then(function (res) {
      self._deleting = false;
      self.setData({ deleting: false, confirmingDeleteId: '' });
      if (res && res.success) {
        wx.showToast({ title: '地址已删除', icon: 'none' });
        self.setData({ loading: true });
        self.load();
      } else {
        account.toast((res && res.error && res.error.message) || '删除失败，请稍后重试');
      }
    }).catch(function (err) {
      self._deleting = false;
      self.setData({ deleting: false });
      account.toast((err && err.message) || '网络异常，删除失败，请稍后重试');
    });
  },
});
