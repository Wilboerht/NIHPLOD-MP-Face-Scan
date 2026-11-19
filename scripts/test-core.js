const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const storage = {};
const queue = [];
let app = null;
let capturedPage = null;
let failures = 0;

function assert(cond, message) {
  if (cond) console.log('ok:', message);
  else { failures += 1; console.error('FAIL:', message); }
}
function resetStorage() { for (const key of Object.keys(storage)) delete storage[key]; }

global.wx = {
  getStorageSync: (key) => (key in storage ? storage[key] : ''),
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: (key) => { delete storage[key]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
  getFileSystemManager: () => ({ unlink: () => {}, readFile: () => {} }),
  getPrivacySetting: (opts) => opts && opts.success && opts.success({ needAuthorization: false }),
  request: (opts) => {
    const next = queue.shift();
    if (!next) { opts.fail && opts.fail({ errMsg: 'mock request failed' }); return; }
    const body = Object.prototype.hasOwnProperty.call(next, 'data') ? next.data : next;
    opts.success && opts.success({ statusCode: next.statusCode || 200, data: body, header: next.header || {} });
  },
  showToast: () => {},
  reLaunch: () => {},
  navigateBack: () => {},
  stopPullDownRefresh: () => {},
  getCurrentPages: () => [{ route: 'pages/index/index', options: {} }],
  getWindowInfo: () => ({ statusBarHeight: 20, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ SDKVersion: '3.16.2', pixelRatio: 2 }),
  getAppBaseInfo: () => ({ SDKVersion: '3.16.2' }),
  getRandomValues: (opts) => opts.success && opts.success({ randomValues: new Uint8Array(256).buffer }),
};
global.getApp = () => app;
global.getCurrentPages = () => [{ route: 'pages/index/index', options: {} }];
global.App = (obj) => { app = obj; };
global.Page = (obj) => {
  capturedPage = obj;
  obj.data = JSON.parse(JSON.stringify(obj.data || {}));
  obj.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
};

const config = require(path.join(ROOT, 'config.js'));
const K = config.STORAGE_KEYS;
const auth = require(path.join(ROOT, 'utils/auth.js'));
const util = require(path.join(ROOT, 'utils/util.js'));
const reportView = require(path.join(ROOT, 'utils/report-view.js'));
require(path.join(ROOT, 'app.js'));
require(path.join(ROOT, 'pages/analyzing/analyzing.js'));
const analyzingPage = capturedPage;
require(path.join(ROOT, 'pages/history/history.js'));
const historyPage = capturedPage;

function baseSession() {
  storage[K.USER_INFO] = { id: 'u1', name: 'A' };
  storage[K.ACCESS_TOKEN] = 'token';
  storage[K.REFRESH_TOKEN] = 'refresh';
  storage[K.TOKEN_EXPIRES_AT] = Date.now() + 3600000;
}

(async () => {
  // 文本清洗
  assert(util.plainText('用量&lt;1ml &amp; 温和') === '用量<1ml & 温和', 'plainText decodes entities');

  // 隐私同意：新同意 -> 服务端缺失 -> 补授权 -> 标记已同步
  resetStorage(); baseSession();
  app.recordPrivacyConsent({ pendingSync: true });
  assert(storage[K.PRIVACY_AGREED].pendingSync === true, 'fresh consent is pending');
  queue.push({ data: { success: true, data: { version: config.PRIVACY_VERSION, granted: [], missing: ['privacy','face','health','ai'] } } });
  queue.push({ data: { success: true, data: { version: config.PRIVACY_VERSION, granted: ['privacy','face','health','ai'], missing: [] } } });
  assert(await app.syncPrivacyConsent() === true, 'sync grants missing consent');
  assert(storage[K.PRIVACY_AGREED].pendingSync === false, 'sync marks consent synced');

  // 已同步的同意在服务端撤回后不能被静默重授
  queue.push({ data: { success: true, data: { version: config.PRIVACY_VERSION, granted: [], missing: ['privacy','face','health','ai'] } } });
  assert(await app.syncPrivacyConsent() === false, 'sync refuses silent re-grant');
  assert(!storage[K.PRIVACY_AGREED], 'revoked consent cleared locally');

  // 服务端撤回时 index 的只读核对应清本地；待同步中的本地同意不拦截
  resetStorage(); baseSession();
  storage[K.PRIVACY_AGREED] = {
    version: config.PRIVACY_VERSION,
    consentedAt: new Date().toISOString(),
    userId: 'u1',
    scopes: ['privacy', 'face', 'health', 'ai'],
    pendingSync: false,
  };
  queue.push({ data: { success: true, data: { version: config.PRIVACY_VERSION, granted: [], missing: ['privacy','face','health','ai'] } } });
  const reconciled = await new Promise((resolve) => app.reconcilePrivacyConsent(resolve));
  assert(reconciled === false && !storage[K.PRIVACY_AGREED], 'reconcile clears server-revoked consent');
  storage[K.PRIVACY_AGREED] = {
    version: config.PRIVACY_VERSION,
    consentedAt: new Date().toISOString(),
    userId: 'u1',
    scopes: ['privacy', 'face', 'health', 'ai'],
    pendingSync: true,
  };
  const pendingReconciled = await new Promise((resolve) => app.reconcilePrivacyConsent(resolve));
  assert(pendingReconciled === true && queue.length === 0, 'pending consent skips read-only reconcile');

  // 自动续期失败：保留在途流程，登录后按账号归属决定是否清理
  resetStorage(); baseSession();
  storage[K.ANSWERS] = { gender: 'female' };
  storage[K.ANSWERS_SAVED_AT] = Date.now();
  storage[K.FACE_IMAGE_PATH] = '/tmp/front.jpg';
  storage[K.PENDING_ANALYSIS] = { sessionId: 's', fingerprint: 'f', createdAt: Date.now() };
  auth.clearSession({ preserveFlow: true, preservePendingRoute: true });
  assert(!storage[K.ACCESS_TOKEN] && storage[K.FLOW_OWNER] === 'u1', 'preserveFlow stores owner');
  assert(storage[K.ANSWERS] && storage[K.FACE_IMAGE_PATH] && storage[K.PENDING_ANALYSIS], 'preserveFlow keeps in-flight data');
  storage[K.USER_INFO] = { id: 'u1' };
  assert(auth.ensureFlowOwnerForCurrentUser() === false && !!storage[K.ANSWERS], 'same user keeps flow');
  storage[K.USER_INFO] = { id: 'u2' };
  storage[K.FLOW_OWNER] = 'u1';
  assert(auth.ensureFlowOwnerForCurrentUser() === true && !storage[K.ANSWERS], 'different user clears flow');

  // 启动清理：旧版 pending 里的完整面部结果会被移除
  resetStorage();
  storage[K.PENDING_ANALYSIS] = { sessionId: 's', fingerprint: 'f', createdAt: Date.now(), faceAnalysis: { status: 'done', health: 'x' } };
  auth.cleanupStaleFlowState();
  const pending = storage[K.PENDING_ANALYSIS];
  assert(pending && !pending.faceAnalysis && pending.faceReady === true, 'cleanup strips pending PII');

  // 过期问卷草稿清理
  resetStorage();
  storage[K.ANSWERS] = { gender: 'female' };
  storage[K.ANSWERS_SAVED_AT] = Date.now() - 8 * 24 * 3600 * 1000;
  storage[K.FLOW_OWNER] = 'u1';
  auth.cleanupStaleFlowState();
  assert(!storage[K.ANSWERS] && !storage[K.FLOW_OWNER], 'expired draft and owner removed');

  // 分析 session 复用规则
  storage['mp_flow_session_id'] = 's1';
  storage[K.PENDING_ANALYSIS] = { sessionId: 's1', fingerprint: 'fp1', faceReady: true, createdAt: Date.now() };
  analyzingPage._faceReady = false;
  assert(analyzingPage.loadPending('fp2') === false && analyzingPage._needsNewSession === true, 'changed fingerprint on same flow forces new session');
  storage[K.PENDING_ANALYSIS] = { sessionId: 's2', fingerprint: 'fp2', createdAt: Date.now() - 31 * 60 * 1000 };
  storage['mp_flow_session_id'] = 's2';
  assert(analyzingPage.loadPending('fp2') === false && analyzingPage._needsNewSession === true, 'expired pending forces new session');
  storage[K.PENDING_ANALYSIS] = { sessionId: 's3', fingerprint: 'fp3', faceReady: true, faceAnalysis: { secret: 1 }, createdAt: Date.now() };
  storage['mp_flow_session_id'] = 'new';
  analyzingPage._faceAnalysis = null;
  assert(analyzingPage.loadPending('fp3') === true && analyzingPage._faceAnalysis === null && analyzingPage._faceReady === true, 'only faceReady loaded from pending');
  assert(analyzingPage.errorActionFor({ isConsent: true }) === 'reconsent', 'consent error routed to reconsent');
  assert(analyzingPage.errorActionFor({ statusCode: 429 }) === 'home', 'quota error routed home');
  assert(analyzingPage.errorActionFor(null, 'FACE_REQUIRED') === 'retake', 'face error routed to retake');

  // ReportView 文本清洗与 key
  resetStorage(); baseSession();
  const view = {
    meta: { skinTypeLabel: '混干', overallScore: 72, analyzedAt: '2026-11-14T00:00:00.000Z' },
    summary: { overview: '用量&lt;1ml', topFinding: { id: 'f1', title: '泛红&amp;干燥', severity: 'mild', severityLabel: '轻度', observation: '观察' }, strengths: ['稳定'], nextStep: '继续' },
    dimensions: [{ key: 'waterOil', label: '水油平衡', score: 70, gradeLabel: '良好', details: 'A &amp; B' }],
    zones: [{ key: 'forehead', condition: '正常', advice: '保持', scores: [], needsAttention: false }],
    conditions: [{ condition: '痘痘', severity: 'mild', severityLabel: '轻度', area: '额头', description: '描述' }],
    findings: [{ id: 'f1', title: '泛红', observation: '观察', evidence: [], severity: 'mild', severityLabel: '轻度' }],
    routine: { morning: [{ text: '清洁' }], night: [{ text: '修护' }] },
    safety: { excluded: ['酒精'], actives: [], conflicts: [], patchTest: '', sunProtection: '', whenToSeeDoctor: [] },
    next: { retestFocus: ['水油平衡'], retestInDays: 28 },
    products: [], legacy: false,
  };
  const pageData = reportView.toPageData(view);
  assert(pageData.summary === '用量<1ml' && pageData.topFinding.title === '泛红&干燥', 'ReportView decodes entities');
  assert(pageData.dimensionList[0].details === 'A & B', 'ReportView dimension text decoded');
  assert(pageData.conditions[0].key && pageData.routine.morning[0].key === 'm0' && pageData.routine.night[0].key === 'n0', 'ReportView keys added');

  // 历史列表静默刷新保留旧分页并保持排序
  resetStorage(); baseSession();
  historyPage.onLoad();
  function item(i) {
    return { sessionId: 's' + i, completedAt: '2026-11-' + String(20 - i).padStart(2, '0') + 'T10:00:00.000Z', view: { overallScore: 70, skinTypeLabel: '混干', topFinding: { title: 't' + i } } };
  }
  const first = [];
  for (let i = 0; i < 20; i++) first.push(item(i));
  queue.push({ history: first, pagination: { total: 40, totalPages: 2 } });
  await historyPage.fetchHistory(1);
  const fresh = [{ sessionId: 'new', completedAt: '2026-11-30T10:00:00.000Z', view: {} }];
  for (let i = 0; i < 19; i++) fresh.push(item(i));
  queue.push({ history: fresh, pagination: { total: 40, totalPages: 2 } });
  await historyPage.fetchHistory(1, { silent: true });
  assert(historyPage.data.list.length === 21, 'history silent refresh keeps older pages');
  assert(historyPage.data.list[0].sessionId === 'new', 'history silent refresh keeps sort order');
  assert(historyPage.data.hasMore === true, 'history hasMore uses total');

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll core tests passed');
})();
