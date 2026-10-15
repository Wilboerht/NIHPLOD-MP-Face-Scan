// 全局常量配置
// 接口字段与 H5 仓库 skin-advisor-standalone 的 src/app/api/** 保持一致
module.exports = {
  // 官网主站（登录 / token 刷新）
  OFFICIAL_BASE_URL: 'https://nihplod.cn',
  // 测肤子站（questions / face-analyze / analyze / session/status / history）
  ADVISORY_BASE_URL: 'https://smart.nihplod.cn',
  // OAuth public client（无 secret）
  MP_CLIENT_ID: 'wechat-mp-skin',

  // 隐私协议版本：随 analyze 请求上报 privacyConsent
  PRIVACY_VERSION: 'mp-1.0',

  // 微信小店：appid / 商品页路径均为占位，待小店后台获取后填入；
  // appid 为空时结果页「微信小店购买」按钮自动隐藏
  WECHAT_SHOP: {
    appid: '',
    itemPath: '',
  },

  // 本地存储 key
  STORAGE_KEYS: {
    ACCESS_TOKEN: 'mp_access_token',
    REFRESH_TOKEN: 'mp_refresh_token',
    TOKEN_EXPIRES_AT: 'mp_token_expires_at',
    USER_INFO: 'mp_user_info',
    NEED_BINDING: 'mp_need_binding',
    PRIVACY_AGREED: 'mp_privacy_agreed',
    ANSWERS: 'mp_advisor_answers',
    SKIN_STATE: 'mp_skin_state',
    FACE_IMAGE_PATH: 'mp_face_image_path',
    FACE_IMAGE_SIDE_PATHS: 'mp_face_image_side_paths',
    RESULT_PREFIX: 'mp_result_',
    LATEST_SESSION: 'mp_latest_session',
  },
};
