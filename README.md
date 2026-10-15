# 肌智派 AI 测肤小程序（NIHPLOD-MP-Face-Scan）

基于微信小程序的 AI 测肤应用：问卷 + 人脸拍摄 + 云端 AI 分析，生成十维皮肤报告与个性化护肤建议。

- 原生小程序（无框架），基础库 latest，支持 `lazyCodeLoading`
- 人脸采集使用微信 VisionKit（106 关键点）做实时姿态检测与自动拍摄
- 接口与 H5 仓库 `skin-advisor-standalone` 对齐（字段、错误格式、轮询策略）

## 功能流程

```
首页 → 隐私协议同意 → 微信一键登录（新用户绑手机号）
  → 问卷答题（性别前置 + dependsOn 条件题 + 次数限额拦截）
  → 人脸采集（正脸/右转/左转/抬头，VisionKit 自动拍摄）
  → 图片上传（OSS 签名 + 原始字节 PUT）
  → 提交分析（异步任务，3s 轮询 × 60 = 180s）
  → 测肤报告（雷达图 / 维度明细 / 问题与建议 / 商品推荐 / 证书海报）
  → 历史报告（分页列表 + 详情回看）
```

## 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 首页 | `pages/index` | 自定义导航栏、隐私弹窗、登录态入口 |
| 登录 | `pages/login` | 微信一键登录；新用户 `getPhoneNumber` 免短信绑手机号 |
| 问卷 | `pages/questionnaire` | 动态题目、`dependsOn` 条件显示、测肤次数限额拦截 |
| 拍摄 | `pages/capture` | 四步姿态引导，VisionKit 106 关键点自动检测与拍摄 |
| 分析中 | `pages/analyzing` | 提交异步分析任务并轮询状态，模拟进度条 |
| 报告 | `pages/result` | 十维雷达图（canvas 2d）、评分明细、商品推荐、证书海报生成/保存/分享 |
| 历史 | `pages/history` | 服务端历史报告分页列表，点击回看报告 |
| 我的 | `pages/profile` | 用户信息编辑 |

组件：`components/privacy-popup`（隐私协议弹窗）

## 目录结构

```
├── app.js / app.json / app.wxss   # 应用入口、路由与全局样式
├── config.js                      # 全局常量（域名、client_id、存储 key、小店占位）
├── project.config.json            # 开发者工具项目配置（appid 等）
├── components/
│   └── privacy-popup/             # 隐私协议弹窗组件
├── images/                        # 静态图片资源
├── pages/                         # 8 个页面（见上表）
└── utils/
    ├── auth.js                    # 登录 / 绑手机 / token 刷新 / 登出（OAuth public client）
    ├── request.js                 # 统一请求封装：双 base、401 静默刷新重试、错误解析
    ├── upload.js                  # 图片上传：/api/oss/sign 签名 + PUT 原始字节
    ├── radar.js                   # 十维雷达图绘制（canvas 2d，dpr 适配）
    ├── poster.js                  # 证书海报端侧合成（底图 + 动态数据叠加 + 二维码）
    ├── util.js                    # 维度标签、格式化等公共方法
    └── uuid.js                    # sessionId 生成
```

## 后端接口

| 域名 | 用途 |
| --- | --- |
| `https://nihplod.cn` | 官网主站：登录（`/api/auth/wechat/miniprogram-login`）、token 刷新（`/api/oauth/token`）、撤销（`/api/oauth/revoke`） |
| `https://smart.nihplod.cn` | 测肤子站：`questions` / `oss/sign` / `analyze` / `session/status` / `advisor/history` |

鉴权模型：登录拿到 `accessToken` + `refreshToken`，请求层自动注入 `Authorization: Bearer`；token 过期前 5 分钟主动预刷新，401 时静默刷新一次并重试原请求，仅服务端明确拒绝（4xx ≠ 429）才清登录态跳登录页。

## 开发与运行

1. 用微信开发者工具「导入项目」选择本项目根目录（AppID：`wxb52753aa11ed6654`）
2. 无需 npm 构建（`nodeModules: false`），直接编译运行
3. 接口域名需在微信公众平台配置 `request` / `uploadFile` 合法域名（`nihplod.cn`、`smart.nihplod.cn`、OSS 上传域名）

## 配置说明

- `config.js`
  - `OFFICIAL_BASE_URL` / `ADVISORY_BASE_URL`：双后端域名
  - `WECHAT_SHOP`：微信小店 appid 与商品路径，为空时报告页隐藏「小店购买」按钮
  - `PRIVACY_VERSION`：隐私协议版本，随 analyze 请求以上报 `privacyConsent`
- `pages/capture/capture.js` 顶部 `CALIBRATION`：真机方向校准开关（`MIRROR_X` / `SWAP_XY`），跨机型适配时调整
- `project.private.config.json` 为本地私有配置，不入库（见 `.gitignore`）

## 隐私与数据

- 首次使用需同意隐私协议（设备级存储，与账号无关，登出不清除）
- 登出会清理：token、用户信息、问卷答案、人脸照片路径、皮肤状态、报告缓存
- 人脸图片不落地服务端前经 OSS 签名直传，避免 multipart 二次转发
