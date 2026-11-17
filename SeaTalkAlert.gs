/**
 * SeaTalk Alert System for Data Delay Notifications
 * Sends automated alerts to SeaTalk group at 09:00 and 15:00 daily
 * when operational or KPI data sources are delayed compared to SLA.
 */

var SEATALK_ALERT_CFG = {
  PROP_WEBHOOK: 'SEATALK_DATA_DELAY_WEBHOOK',
  DEFAULT_WEBHOOK: 'https://openapi.seatalk.io/webhook/group/FFMmzxsaRR2dE7vS4eQSVQ',
  DEFAULT_D0_URL: 'https://docs.google.com/spreadsheets/d/1_tgFNXYfbNoz3OF8sqD9QIwazwvjT6Va_OpxmbdZFEQ/edit?gid=402233086#gid=402233086',
  DEFAULT_WEB_APP_URL: 'https://script.google.com/a/macros/spxexpress.com/s/AKfycbxT3IHYiZ2YKyommL2lGWjLg65ph2TFHDzawQOVSIvFJnwua0yB5RdmZ8EYfcHvLr7p1Q/exec',
  DEFAULT_KPI_URL: 'https://docs.google.com/spreadsheets/d/1VXYAZL6YfTbok7Ip-7q-hWRyXOatHd0TUINE2OmZ1QI',
  PROP_ENABLED: 'SEATALK_DATA_DELAY_ENABLED',
  PROP_LAST_SENT: 'SEATALK_DATA_DELAY_LAST_SENT',
  HOURS: [9, 15],
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  HANDLER_NAME: 'runScheduledSeaTalkDataDelayAlert'
};

function getEffectiveSeaTalkWebhookUrl_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(SEATALK_ALERT_CFG.PROP_WEBHOOK) || SEATALK_ALERT_CFG.DEFAULT_WEBHOOK || '';
}


/**
 * Scheduled trigger entry point (runs at 09:00 and 15:00).
 * Can also be triggered manually with force=true.
 */
function runScheduledSeaTalkDataDelayAlert(force) {
  var props = PropertiesService.getScriptProperties();
  var enabledProp = props.getProperty(SEATALK_ALERT_CFG.PROP_ENABLED);
  if (enabledProp === 'false' && !force) {
    Logger.log('[SeaTalk Alert] Cảnh báo đang tắt trong cấu hình (SEATALK_DATA_DELAY_ENABLED = false).');
    return { ok: false, reason: 'ALERT_DISABLED' };
  }

  var webhookUrl = getEffectiveSeaTalkWebhookUrl_();
  if (!webhookUrl) {
    Logger.log('[SeaTalk Alert] Chưa cấu hình SEATALK_DATA_DELAY_WEBHOOK.');
    return { ok: false, error: 'NO_WEBHOOK_CONFIGURED' };
  }

  var now = new Date();
  var nowStr = Utilities.formatDate(now, SEATALK_ALERT_CFG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  var currentHour = Number(Utilities.formatDate(now, SEATALK_ALERT_CFG.TIMEZONE, 'HH'));
  var hourSlot = currentHour < 12 ? '09:00' : '15:00';

  var health = null;
  try {
    health = getSourceHealthInternal_();
  } catch (err) {
    Logger.log('[SeaTalk Alert] Lỗi khi kiểm tra getSourceHealthInternal_: ' + (err.message || err));
    health = { error: String(err.message || err), sources: [] };
  }

  // Filter sources that are genuinely delayed at the dataset level.
  // Ignore partial inactive hubs (e.g. lateHubs) if the sheet has already reached expected date.
  var delayedSources = [];
  if (health && Array.isArray(health.sources)) {
    var todayStr = health.today || Utilities.formatDate(now, SEATALK_ALERT_CFG.TIMEZONE, 'yyyy-MM-dd');
    delayedSources = health.sources.filter(function (s) {
      if (s.status === 'CONFIGURED') return false;
      if (s.status === 'ERROR' || s.status === 'MISSING' || s.status === 'EMPTY') return true;

      // Nguồn live: chậm nếu chưa có dữ liệu hôm nay hoặc trễ > 120 phút
      if (s.kind === 'live') {
        if (s.latestDate && s.latestDate !== todayStr) return true;
        if (s.ageMinutes != null && s.ageMinutes > 120) return true;
        return false;
      }

      // Nguồn daily / eod: chỉ báo trễ nếu ngày mới nhất của sheet chưa đạt expectedDate (D-1)
      // Không cảnh báo khi chỉ có một vài HUB riêng lẻ chậm tiến độ
      if (s.expectedDate && s.latestDate) {
        return s.latestDate < s.expectedDate;
      }

      if (!s.latestDate) return true;
      return false;
    });
  }

  // If no sources are delayed and not forced, stay silent to avoid spamming the group
  if (delayedSources.length === 0 && !force) {
    Logger.log('[SeaTalk Alert] ' + nowStr + ' (' + hourSlot + '): Tất cả nguồn dữ liệu đều ĐÚNG TIẾN ĐỘ. Không gửi cảnh báo.');
    return {
      ok: true,
      sent: false,
      delayedCount: 0,
      hourSlot: hourSlot,
      timestamp: nowStr,
      reason: 'ALL_DATA_FRESH'
    };
  }

  var message = formatSeaTalkDelayedDataMessage_(health, delayedSources, hourSlot, nowStr, force);
  var sendResult = sendSeaTalkMessage_(webhookUrl, message);

  if (sendResult.ok) {
    props.setProperty(SEATALK_ALERT_CFG.PROP_LAST_SENT, nowStr + ' (' + delayedSources.length + ' nguồn chậm)');
  }

  return {
    ok: sendResult.ok,
    sent: true,
    delayedCount: delayedSources.length,
    hourSlot: hourSlot,
    timestamp: nowStr,
    response: sendResult
  };
}

/**
 * Format clean, concise SeaTalk alert message.
 */
function formatSeaTalkDelayedDataMessage_(health, delayedSources, hourSlot, nowStr, isTest) {
  if (delayedSources.length === 0) {
    return '✅ **[TIẾN ĐỘ DỮ LIỆU HCM - ' + hourSlot + ']**\n' +
      '⏰ ' + nowStr + '\n' +
      'Tất cả nguồn dữ liệu đều đúng tiến độ.';
  }

  var lines = [];
  lines.push('⚠️ **[CẢNH BÁO TRỄ DỮ LIỆU HCM - ' + hourSlot + ']**');
  lines.push('⏰ ' + nowStr + (isTest ? ' *(Thử nghiệm)*' : ''));
  lines.push('Phát hiện **' + delayedSources.length + ' nguồn** chưa cập nhật:');
  lines.push('');

  var statusLabels = {
    INACTIVE: 'Chưa cập nhật',
    ERROR: 'Lỗi nguồn',
    MISSING: 'Thiếu sheet',
    EMPTY: 'Trống dữ liệu'
  };

  delayedSources.forEach(function (item) {
    var st = statusLabels[item.status] || item.status || 'Chưa cập nhật';
    var latest = item.latestDate || (item.latestAt ? item.latestAt.slice(11, 16) : '') || 'chưa có';
    var lateNote = (item.kind === 'live' && item.ageMinutes > 0) ? (' (trễ ' + item.ageMinutes + 'p)') : '';
    lines.push('• **' + item.name + ':** ' + st + lateNote + ' — Dữ liệu: `' + latest + '`');
  });

  var webAppUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || SEATALK_ALERT_CFG.DEFAULT_WEB_APP_URL;
  if (webAppUrl) {
    lines.push('');
    lines.push('👉 [Mở Trang Giám Sát Dữ Liệu](' + webAppUrl + ')');
  }

  return lines.join('\n');
}

function sendSeaTalkMessage_(webhookUrl, content) {
  if (!webhookUrl) return { ok: false, error: 'WEBHOOK_URL_EMPTY' };

  var payload = {
    tag: 'markdown',
    markdown: {
      content: content
    }
  };

  try {
    var res = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    Logger.log('[SeaTalk Alert] Webhook status ' + code + ': ' + text);
    return {
      ok: code >= 200 && code < 300,
      code: code,
      body: text
    };
  } catch (err) {
    Logger.log('[SeaTalk Alert] Webhook error: ' + (err.message || err));
    return {
      ok: false,
      error: String(err.message || err)
    };
  }
}

/**
 * RPC API: Get SeaTalk Alert configuration and trigger status.
 */
function getSeaTalkAlertConfig() {
  requireAdmin_();
  var props = PropertiesService.getScriptProperties();
  var webhook = getEffectiveSeaTalkWebhookUrl_();
  var enabledProp = props.getProperty(SEATALK_ALERT_CFG.PROP_ENABLED);
  var enabled = enabledProp === 'true' || (enabledProp == null && !!webhook);
  var lastSent = props.getProperty(SEATALK_ALERT_CFG.PROP_LAST_SENT) || null;

  var triggers = [];
  try {
    triggers = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === SEATALK_ALERT_CFG.HANDLER_NAME;
    });
  } catch (e) {
    Logger.log('[SeaTalk Alert] getProjectTriggers warning: ' + e);
  }

  // Tự động kích hoạt triggers nếu webhook khả dụng và chưa bị tắt
  if (enabledProp !== 'false' && webhook && triggers.length === 0) {
    try {
      setupSeaTalkDataDelayTriggersInternal_();
      triggers = ScriptApp.getProjectTriggers().filter(function (t) {
        return t.getHandlerFunction() === SEATALK_ALERT_CFG.HANDLER_NAME;
      });
      enabled = true;
    } catch (eTrig) {
      Logger.log('[SeaTalk Alert] auto-setup triggers warning: ' + eTrig);
    }
  }

  var masked = '';
  if (webhook) {
    var m = webhook.match(/^https:\/\/openapi\.seatalk\.io\/webhook\/group\/([a-zA-Z0-9_\-]+)$/);
    if (m && m[1].length > 8) {
      masked = 'https://openapi.seatalk.io/webhook/group/' + m[1].slice(0, 4) + '••••••••' + m[1].slice(-4);
    } else {
      masked = 'https://openapi.seatalk.io/webhook/group/••••••••';
    }
  }

  return {
    hasWebhook: !!webhook,
    maskedWebhook: masked,
    enabled: enabled && triggers.length > 0,
    triggerCount: triggers.length,
    hours: SEATALK_ALERT_CFG.HOURS,
    scheduleFormatted: SEATALK_ALERT_CFG.HOURS.map(function (h) { return String(h).padStart(2, '0') + ':00'; }).join(' & '),
    timezone: SEATALK_ALERT_CFG.TIMEZONE,
    lastSent: lastSent
  };
}

/**
 * RPC API: Save SeaTalk Webhook URL and activate triggers.
 */
function saveSeaTalkWebhookUrl(url) {
  requireAdmin_();
  var clean = String(url || '').trim();
  if (clean && !/^https:\/\/openapi\.seatalk\.io\/webhook\/group\//.test(clean)) {
    throw new Error('URL SeaTalk Webhook không hợp lệ. Định dạng chuẩn: https://openapi.seatalk.io/webhook/group/...');
  }

  var props = PropertiesService.getScriptProperties();
  if (clean) {
    props.setProperty(SEATALK_ALERT_CFG.PROP_WEBHOOK, clean);
    setupSeaTalkDataDelayTriggersInternal_();
  } else {
    props.deleteProperty(SEATALK_ALERT_CFG.PROP_WEBHOOK);
    removeSeaTalkDataDelayTriggersInternal_();
  }

  return getSeaTalkAlertConfig();
}

/**
 * RPC API: Toggle SeaTalk Alert triggers on / off.
 */
function toggleSeaTalkAlertSchedule(enable) {
  requireAdmin_();
  if (enable) {
    setupSeaTalkDataDelayTriggersInternal_();
  } else {
    removeSeaTalkDataDelayTriggersInternal_();
  }
  return getSeaTalkAlertConfig();
}

/**
 * RPC API: Test SeaTalk alert immediately.
 */
function testSeaTalkAlert() {
  requireAdmin_();
  return runScheduledSeaTalkDataDelayAlert(true);
}

/**
 * Internal: Setup daily time-based triggers at 09:00 and 15:00.
 */
function setupSeaTalkDataDelayTriggersInternal_() {
  var existing = [];
  try {
    existing = ScriptApp.getProjectTriggers();
    existing.forEach(function (t) {
      if (t.getHandlerFunction() === SEATALK_ALERT_CFG.HANDLER_NAME) {
        ScriptApp.deleteTrigger(t);
      }
    });
  } catch (e) {
    Logger.log('[SeaTalk Alert] delete old triggers warning: ' + e);
  }

  var created = [];
  try {
    SEATALK_ALERT_CFG.HOURS.forEach(function (hour) {
      var trigger = ScriptApp.newTrigger(SEATALK_ALERT_CFG.HANDLER_NAME)
        .timeBased()
        .atHour(hour)
        .nearMinute(0)
        .everyDays(1)
        .inTimezone(SEATALK_ALERT_CFG.TIMEZONE)
        .create();
      created.push({ hour: hour, triggerId: trigger.getUniqueId() });
    });
  } catch (eTrig) {
    Logger.log('[SeaTalk Alert] create trigger warning: ' + eTrig);
  }

  PropertiesService.getScriptProperties().setProperty(SEATALK_ALERT_CFG.PROP_ENABLED, 'true');
  return { ok: true, created: created };
}

/**
 * Internal: Remove triggers.
 */
function removeSeaTalkDataDelayTriggersInternal_() {
  var count = 0;
  try {
    var existing = ScriptApp.getProjectTriggers();
    existing.forEach(function (t) {
      if (t.getHandlerFunction() === SEATALK_ALERT_CFG.HANDLER_NAME) {
        ScriptApp.deleteTrigger(t);
        count++;
      }
    });
  } catch (e) {
    Logger.log('[SeaTalk Alert] remove triggers warning: ' + e);
  }
  PropertiesService.getScriptProperties().setProperty(SEATALK_ALERT_CFG.PROP_ENABLED, 'false');
  return { ok: true, removed: count };
}

/**
 * Public: Bật / cài đặt trigger cảnh báo SeaTalk lúc 09:00 và 15:00 hàng ngày.
 * Có thể chạy trực tiếp từ Apps Script Editor.
 */
function enableSeaTalkAlertNow() {
  return setupSeaTalkDataDelayTriggersInternal_();
}

/**
 * Public alias: Cài đặt trigger cảnh báo SeaTalk
 */
function installSeaTalkAlertTrigger() {
  return setupSeaTalkDataDelayTriggersInternal_();
}

/**
 * Public: Tắt lịch cảnh báo SeaTalk.
 * Có thể chạy trực tiếp từ Apps Script Editor.
 */
function disableSeaTalkAlertNow() {
  return removeSeaTalkDataDelayTriggersInternal_();
}

/**
 * Public: Chạy gửi thử cảnh báo SeaTalk ngay lập tức từ Apps Script Editor.
 */
function testSeaTalkAlertNow() {
  return runScheduledSeaTalkDataDelayAlert(true);
}

