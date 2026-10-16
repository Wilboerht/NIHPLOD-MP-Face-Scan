// 订阅消息授权（一次性订阅：每次授权 = 一次推送额度，用完需用户再次授权）
// 必须在用户点击的调用栈内调用；未配置模板 / 用户拒绝 / 接口失败均静默降级，不阻断流程
var config = require('../config.js');

/**
 * 请求「报告完成通知」（可选含「复测提醒」）订阅授权
 * cb：无论 accept / reject / fail 都会回调（继续主流程用）
 */
function requestSubscription(cb) {
  var done = function () {
    if (cb) cb();
  };
  if (!wx.requestSubscribeMessage) {
    done();
    return;
  }
  var templates = config.SUBSCRIBE_TEMPLATES || {};
  var ids = [];
  if (templates.REPORT_READY) ids.push(templates.REPORT_READY);
  if (templates.RETEST_REMINDER) ids.push(templates.RETEST_REMINDER);
  if (ids.length === 0) {
    done(); // 模板未配置（功能未启用）
    return;
  }
  wx.requestSubscribeMessage({
    tmplIds: ids,
    complete: done,
  });
}

module.exports = {
  requestSubscription: requestSubscription,
};
