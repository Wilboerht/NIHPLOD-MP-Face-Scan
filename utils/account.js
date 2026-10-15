// 用户中心共享逻辑：主站资料读写（OAuth userinfo / 地址 / 换绑 / 密码）与凭证变更后的重新登录
// 注意：微信 wx.request 的 method 白名单不含 PATCH，主站已为小程序提供 PUT 别名（语义与 PATCH 一致）
var config = require('../config.js');
var request = require('./request.js').request;

// GET /api/oauth/userinfo（profile/phone/membership/birthday scope 按 token 裁剪返回）
function fetchProfile() {
  return request({
    base: 'official',
    url: '/api/oauth/userinfo',
    method: 'GET',
    showError: false,
  }).then(normalizeProfile);
}

// 归一化响应：avatar 补绝对地址；birthday 裁剪为 YYYY-MM-DD；phone 仅接受打码格式
// （主站返回的是掩码号；微信占位号等非 1[3-9] 真实号的掩码值一律视为未绑定，与 H5 maskPhoneForDisplay 对齐）
function normalizeProfile(data) {
  var d = data || {};
  var avatar = d.avatar || '';
  if (avatar.charAt(0) === '/') avatar = 'https://nihplod.cn' + avatar;
  var phone = d.phone || d.phone_number || '';
  return {
    nickname: d.nickname || '',
    avatarUrl: avatar,
    gender: d.gender === 'male' || d.gender === 'female' ? d.gender : null,
    birthday: typeof d.birthday === 'string' && d.birthday ? d.birthday.slice(0, 10) : '',
    phoneMasked: /^\d{3}\*+\d{4}$/.test(phone) ? phone : '',
    hasPassword: typeof d.has_password === 'boolean' ? d.has_password : null,
    membershipLevel: d.membership_level || '',
  };
}

// PUT /api/oauth/userinfo（需 profile:write）：nickname / avatar / gender / birthday
function updateProfile(body) {
  return request({
    base: 'official',
    url: '/api/oauth/userinfo',
    method: 'PUT',
    data: body,
    showError: false,
  });
}

// 403 insufficient_scope：旧 token 缺 profile:write（需重新登录换取新 scope）
function isInsufficientScope(err) {
  return !!(err && err.statusCode === 403 && err.data && err.data.error === 'insufficient_scope');
}

// 同步本地 USER_INFO（首页问候语/历史等展示用）
function updateLocalUser(patch) {
  var user = wx.getStorageSync(config.STORAGE_KEYS.USER_INFO) || {};
  if (patch && patch.name) user.name = patch.name;
  if (patch && patch.avatarUrl) user.avatarUrl = patch.avatarUrl;
  wx.setStorageSync(config.STORAGE_KEYS.USER_INFO, user);
}

// 凭证变更（换绑手机号/改密）后主站已撤销全部会话：清本地态并回登录页
function relogin(message) {
  var auth = require('./auth.js');
  auth.clearSession();
  if (message) wx.showToast({ title: message, icon: 'none', duration: 2500 });
  setTimeout(function () {
    wx.reLaunch({ url: '/pages/login/login' });
  }, 600);
}

// 密码强度校验（与官网一致：8-32 位，含大小写字母与数字）；返回空串表示通过
function validatePassword(password) {
  var p = password || '';
  if (p.length < 8) return '密码至少 8 位';
  if (p.length > 32) return '密码最多 32 位';
  if (!/[A-Z]/.test(p)) return '密码需包含大写字母';
  if (!/[a-z]/.test(p)) return '密码需包含小写字母';
  if (!/[0-9]/.test(p)) return '密码需包含数字';
  return '';
}

function toast(message) {
  wx.showToast({ title: String(message || '操作失败，请重试').slice(0, 28), icon: 'none', duration: 2500 });
}

module.exports = {
  fetchProfile: fetchProfile,
  updateProfile: updateProfile,
  isInsufficientScope: isInsufficientScope,
  updateLocalUser: updateLocalUser,
  relogin: relogin,
  validatePassword: validatePassword,
  toast: toast,
};
