/**
 * SPX PERFORMANCE CONTROL CENTER — V6 SAAS UI SHELL
 * ------------------------------------------------------------
 * Goals:
 * 1) Professional UI shell
 * 2) Gmail identity from Google Workspace
 * 3) Rank-based authorization
 * 4) Smooth UX: no sheet formatting on reads, no long locks,
 *    no server round-trip on every scope click
 *
 * AUTH RANK — SOURCE OF TRUTH
 * ADMIN > SAOM > AOM > SUP > HUB
 *
 * ADMIN:
 *   HCM City + SAOM + AOM + SUP + HUB
 *
 * SAOM:
 *   assigned SAOM + child AOM + child SUP + child HUB
 *
 * AOM:
 *   assigned AOM + child SUP + child HUB
 *
 * SUP:
 *   child HUB only
 *
 * HUB:
 *   assigned HUB only
 *
 * IMPORTANT:
 * Frontend only renders permissions.
 * Every future KPI/data API MUST call assertScopeAccess_().
 */

const APP = Object.freeze({
  NAME: 'HCM Ops Hub',
  SUBTITLE: 'Operations Control Center',
  VERSION: '0.17.29-settings-ux-full-sync',

  // Runtime authorization uses ONLY these two sheets:
  // 1) Adhoc user  -> managed ADMIN / NORMAL accounts + audit
  // 2) Permission  -> automatic SAOM / AOM / SUP / HUB
  USER_SHEET: 'Adhoc user',
  PERMISSION_SHEET: 'Permission',
  PERMISSION_SHEET_ALIASES: ['Permission', 'Permissions'],

  CITY_VALUE: 'HCM_CITY',
  CITY_LABEL: 'HCM City',

  USER_HEADERS: [
    'EMAIL',
    'DISPLAY_NAME',
    'ROLE',
    'SCOPE_TYPE',
    'SCOPE_VALUE',
    'ACTIVE',
    'SOURCE',
    'NOTE',
    'CREATED_AT',
    'UPDATED_AT'
  ]
});


const MODULE_LINK_CFG = Object.freeze({
  PROP_KEY: 'SPX_MODULE_NAV_TREE_SETTINGS_V01722',
  VERSION_PROP: 'SPX_MODULE_NAV_TREE_VERSION_V01722',

  // V0.17.21 hierarchical configuration.
  LEGACY_TREE_PROP_KEY: 'SPX_MODULE_NAV_TREE_SETTINGS_V01721',
  LEGACY_TREE_VERSION_PROP: 'SPX_MODULE_NAV_TREE_VERSION_V01721',

  // V0.17.19/V0.17.20 flat configuration.
  LEGACY_PROP_KEY: 'SPX_MODULE_LINK_SETTINGS_V01719',
  LEGACY_VERSION_PROP: 'SPX_MODULE_LINK_SETTINGS_VERSION_V01719',

  MAX_CHILDREN_PER_MODULE: 20,

  ROLE_TOKENS: Object.freeze([
    'ADMIN', 'NORMAL', 'SAOM', 'AOM', 'ROM', 'SUP', 'LEAD', 'HUB',
    'HUB_VIEWER', 'OPERATIONS_VIEWER', 'CUSTOM'
  ]),

  DISPLAY_MODES: Object.freeze([
    'EMBED', 'NEW_TAB'
  ]),

  MODULES: Object.freeze([
    Object.freeze({ key:'analytics', defaultName:'Operational Analytics', icon:'▥' }),
    Object.freeze({ key:'scope', defaultName:'Scope Explorer', icon:'⌕' }),
    Object.freeze({ key:'backlog', defaultName:'Backlog Management', icon:'▤' }),
    Object.freeze({ key:'compensated', defaultName:'Compensated & Lost', icon:'▧' }),
    Object.freeze({ key:'pickup', defaultName:'Pickup & Driver', icon:'↔' }),
    Object.freeze({ key:'fte', defaultName:'FTE Resource', icon:'👥' }),
    Object.freeze({ key:'reports', defaultName:'Reports & Export', icon:'▧' }),
    Object.freeze({ key:'alerts', defaultName:'Alerts & Exceptions', icon:'♢' })
  ])
});


function moduleDisplayMode_(value) {
  const mode = String(value || 'EMBED').trim().toUpperCase();

  return MODULE_LINK_CFG.DISPLAY_MODES.indexOf(mode) !== -1
    ? mode
    : 'EMBED';
}

function moduleAccessMode_(value) {
  const mode = String(value || 'ALL').trim().toUpperCase();
  return ['ALL', 'ROLES', 'USERS', 'ROLES_OR_USERS'].indexOf(mode) !== -1
    ? mode
    : 'ALL';
}

function normalizeModuleRoleList_(value) {
  const input = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;\n]+/);

  const seen = {};
  const out = [];

  input.forEach(function(raw) {
    let role = String(raw || '').trim().toUpperCase();
    if (!role) return;

    if (/^LEAD(?:\s*\d+)?$/.test(role)) role = 'LEAD';
    if (role === 'LEADER') role = 'LEAD';

    // Allow the standing roles plus future custom uppercase role tokens.
    if (!/^[A-Z][A-Z0-9_-]{1,29}$/.test(role)) return;
    if (seen[role]) return;
    seen[role] = true;
    out.push(role);
  });

  return out.slice(0, 30);
}

function normalizeModuleEmailList_(value) {
  const input = Array.isArray(value)
    ? value.join('\n')
    : String(value || '');

  const matches = input.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const seen = {};

  return matches
    .map(normalizeEmail_)
    .filter(function(email) {
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    })
    .slice(0, 200);
}

function normalizeModuleKey_(value, fallback) {
  let key = String(value || fallback || '').trim().toLowerCase();
  key = key.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!key) key = String(fallback || 'item').toLowerCase();
  return key.slice(0, 50);
}

function normalizeExternalModuleUrl_(url, label) {
  url = String(url == null ? '' : url).trim();
  if (!url) return '';

  if (!/^https?:\/\//i.test(url)) {
    throw new Error('MODULE_URL_INVALID: ' + label + ' must start with http:// or https://');
  }

  if (url.length > 1500) {
    throw new Error('MODULE_URL_TOO_LONG: ' + label);
  }

  return url;
}

function normalizeModuleAccessRule_(row) {
  row = row && typeof row === 'object' ? row : {};

  return {
    accessMode: moduleAccessMode_(row.accessMode),
    allowedRoles: normalizeModuleRoleList_(row.allowedRoles),
    allowedEmails: normalizeModuleEmailList_(row.allowedEmails)
  };
}

function normalizeModuleChild_(row, parentKey, index) {
  row = row && typeof row === 'object' ? row : {};

  const access =
    normalizeModuleAccessRule_(row);

  let name =
    String(
      row.name == null
        ? ''
        : row.name
    ).trim();

  if (!name) {
    name =
      'Sub module ' +
      (index + 1);
  }

  if (name.length > 80) {
    name =
      name.slice(0, 80);
  }

  let description =
    String(
      row.description == null
        ? ''
        : row.description
    ).trim();

  if (description.length > 180) {
    description =
      description.slice(0, 180);
  }

  let buttonLabel =
    String(
      row.buttonLabel == null
        ? ''
        : row.buttonLabel
    ).trim();

  if (!buttonLabel) {
    buttonLabel = 'Open';
  }

  if (buttonLabel.length > 30) {
    buttonLabel =
      buttonLabel.slice(0, 30);
  }

  const key =
    normalizeModuleKey_(
      row.key,
      parentKey +
      '-sub-' +
      (index + 1)
    );

  return {
    key:key,
    name:name,
    description:description,

    url:
      normalizeExternalModuleUrl_(
        row.url,
        parentKey + '/' + key
      ),

    // EMBED = iframe in the SPX Performance frontend.
    // NEW_TAB = old launcher behavior.
    displayMode:
      moduleDisplayMode_(
        row.displayMode
      ),

    buttonLabel:buttonLabel,

    enabled:
      row.enabled !== false,

    accessMode:
      access.accessMode,

    allowedRoles:
      access.allowedRoles,

    allowedEmails:
      access.allowedEmails
  };
}

function defaultModuleNavigationSettings_() {
  const out = {};

  MODULE_LINK_CFG.MODULES
    .forEach(function(m) {
      out[m.key] = {
        key:m.key,
        name:m.defaultName,
        url:'',

        // New default: connected module opens inside the current frontend.
        displayMode:'EMBED',

        buttonLabel:'Open',
        icon:m.icon,
        enabled:true,

        accessMode:'ALL',
        allowedRoles:[],
        allowedEmails:[],

        children:[]
      };
    });

  return out;
}

function normalizeModuleNavigationSettings_(raw) {
  const defaults =
    defaultModuleNavigationSettings_();

  const source =
    raw &&
    typeof raw === 'object'
      ? raw
      : {};

  const out = {};

  MODULE_LINK_CFG.MODULES
    .forEach(function(m) {
      const row =
        source[m.key] &&
        typeof source[m.key] === 'object'
          ? source[m.key]
          : {};

      const access =
        normalizeModuleAccessRule_(
          row
        );

      let name =
        String(
          row.name == null
            ? ''
            : row.name
        ).trim();

      if (!name) {
        name =
          defaults[m.key].name;
      }

      if (name.length > 60) {
        name =
          name.slice(0, 60);
      }

      let buttonLabel =
        String(
          row.buttonLabel == null
            ? ''
            : row.buttonLabel
        ).trim();

      if (!buttonLabel) {
        buttonLabel = 'Open';
      }

      if (buttonLabel.length > 30) {
        buttonLabel =
          buttonLabel.slice(0, 30);
      }

      const rawChildren =
        Array.isArray(row.children)
          ? row.children
          : [];

      const childKeys = {};
      const children = [];

      rawChildren
        .slice(
          0,
          MODULE_LINK_CFG
            .MAX_CHILDREN_PER_MODULE
        )
        .forEach(function(child, index) {
          const normalized =
            normalizeModuleChild_(
              child,
              m.key,
              index
            );

          let key =
            normalized.key;

          let suffix = 2;

          while (childKeys[key]) {
            key =
              normalizeModuleKey_(
                normalized.key +
                '-' +
                suffix,
                m.key +
                '-sub-' +
                (index + 1)
              );

            suffix += 1;
          }

          childKeys[key] = true;
          normalized.key = key;

          children.push(
            normalized
          );
        });

      out[m.key] = {
        key:m.key,
        name:name,

        url:
          normalizeExternalModuleUrl_(
            row.url,
            m.key
          ),

        displayMode:
          moduleDisplayMode_(
            row.displayMode
          ),

        buttonLabel:
          buttonLabel,

        icon:
          m.icon,

        enabled:
          row.enabled !== false,

        accessMode:
          access.accessMode,

        allowedRoles:
          access.allowedRoles,

        allowedEmails:
          access.allowedEmails,

        children:
          children
      };
    });

  return out;
}

function getModuleNavigationSettings_() {
  const props =
    PropertiesService
      .getScriptProperties();

  let raw =
    props.getProperty(
      MODULE_LINK_CFG.PROP_KEY
    );

  let version =
    props.getProperty(
      MODULE_LINK_CFG.VERSION_PROP
    ) || '';

  // V0.17.22 migration:
  // 1) current embedded-tree property
  // 2) V0.17.21 hierarchical tree
  // 3) V0.17.19/V0.17.20 flat module settings
  if (!raw) {
    raw =
      props.getProperty(
        MODULE_LINK_CFG
          .LEGACY_TREE_PROP_KEY
      );

    version =
      version ||
      props.getProperty(
        MODULE_LINK_CFG
          .LEGACY_TREE_VERSION_PROP
      ) ||
      '';
  }

  if (!raw) {
    raw =
      props.getProperty(
        MODULE_LINK_CFG
          .LEGACY_PROP_KEY
      );

    version =
      version ||
      props.getProperty(
        MODULE_LINK_CFG
          .LEGACY_VERSION_PROP
      ) ||
      '0';
  }

  if (!raw) {
    return {
      version:
        version || '0',

      modules:
        defaultModuleNavigationSettings_()
    };
  }

  let parsed = null;

  try {
    parsed =
      JSON.parse(raw);
  } catch (_) {
    parsed = null;
  }

  return {
    version:
      version || '0',

    // Existing V0.17.21 records have no displayMode.
    // normalizeModuleNavigationSettings_ automatically migrates them to EMBED.
    modules:
      normalizeModuleNavigationSettings_(
        parsed
      )
  };
}

function moduleAccessTokens_(access) {
  access = access || {};

  const tokens = {};

  function add(value) {
    value =
      String(value || '')
        .trim()
        .toUpperCase();

    if (value) {
      tokens[value] = true;
    }
  }

  add(access.rank);
  add(access.role);
  add(access.assignedType);

  if (
    String(
      access.rank || ''
    ).toUpperCase() === 'HUB'
  ) {
    add('LEAD');
  }

  if (
    String(
      access.rank || ''
    ).toUpperCase() === 'NORMAL'
  ) {
    add('NORMAL');
  }

  if (access.isAdmin) {
    add('ADMIN');
  }

  return tokens;
}

function moduleRuleMatchesAccess_(row, access) {
  row = row || {};
  access = access || {};

  if (access.isAdmin) return true;
  if (row.enabled === false) return false;

  const mode = moduleAccessMode_(row.accessMode);
  if (mode === 'ALL') return true;

  const email = normalizeEmail_(access.email);
  const allowedEmails = normalizeModuleEmailList_(row.allowedEmails);
  const emailMatch = Boolean(email && allowedEmails.indexOf(email) !== -1);

  const tokens = moduleAccessTokens_(access);
  const allowedRoles = normalizeModuleRoleList_(row.allowedRoles);
  const roleMatch = allowedRoles.some(function(role) {
    return Boolean(tokens[role]);
  });

  if (mode === 'USERS') return emailMatch;
  if (mode === 'ROLES') return roleMatch;
  if (mode === 'ROLES_OR_USERS') return roleMatch || emailMatch;

  return false;
}

function getModuleNavigationForAccess_(access) {
  const raw =
    getModuleNavigationSettings_();

  // ADMIN receives the complete editable configuration.
  if (
    access &&
    access.isAdmin
  ) {
    return raw;
  }

  const visible = {};

  Object.keys(
    raw.modules || {}
  ).forEach(function(key) {
    const parent =
      raw.modules[key];

    if (
      !moduleRuleMatchesAccess_(
        parent,
        access
      )
    ) {
      return;
    }

    const allChildren =
      Array.isArray(parent.children)
        ? parent.children
        : [];

    const children =
      allChildren.filter(function(child) {
        return moduleRuleMatchesAccess_(
          child,
          access
        );
      });

    // Parent group with no launch URL disappears when no child is visible.
    if (
      allChildren.length &&
      !children.length &&
      !parent.url
    ) {
      return;
    }

    visible[key] = {
      key:
        parent.key,

      name:
        parent.name,

      url:
        parent.url,

      displayMode:
        moduleDisplayMode_(
          parent.displayMode
        ),

      buttonLabel:
        parent.buttonLabel,

      icon:
        parent.icon,

      enabled:
        parent.enabled !== false,

      accessMode:
        parent.accessMode,

      // Never send permission-rule details to non-admin users.
      allowedRoles:[],
      allowedEmails:[],

      children:
        children.map(function(child) {
          return {
            key:
              child.key,

            name:
              child.name,

            description:
              child.description,

            url:
              child.url,

            displayMode:
              moduleDisplayMode_(
                child.displayMode
              ),

            buttonLabel:
              child.buttonLabel,

            enabled:
              child.enabled !== false,

            accessMode:
              child.accessMode,

            allowedRoles:[],
            allowedEmails:[]
          };
        })
    };
  });

  return {
    version:
      raw.version,

    modules:
      visible
  };
}

function getModuleNavigationSettings() {
  const access = requireAccess_();
  const x = getModuleNavigationForAccess_(access);

  return {
    ok: true,
    version: x.version,
    modules: x.modules,
    serverTime: new Date().toISOString()
  };
}

function saveModuleNavigationSettings(payload) {
  const admin = requireAdmin_();
  const normalized = normalizeModuleNavigationSettings_(payload || {});
  const now = new Date();
  const version = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyyMMdd-HHmmss');

  PropertiesService.getScriptProperties().setProperties({
    [MODULE_LINK_CFG.PROP_KEY]: JSON.stringify(normalized),
    [MODULE_LINK_CFG.VERSION_PROP]: version
  }, false);

  // New names / tree / permissions must invalidate every user's bootstrap.
  bumpSecurityVersion_();
  clearAdminIndexCache_();
  try { clearFastBootSnapshot_(); } catch (_) {}

  return {
    ok: true,
    savedBy: admin.email,
    version: version,
    modules: normalized,
    savedAt: now.toISOString()
  };
}

function resetModuleNavigationSettings() {
  const admin = requireAdmin_();
  const defaults = defaultModuleNavigationSettings_();
  const now = new Date();
  const version = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyyMMdd-HHmmss');

  PropertiesService.getScriptProperties().setProperties({
    [MODULE_LINK_CFG.PROP_KEY]: JSON.stringify(defaults),
    [MODULE_LINK_CFG.VERSION_PROP]: version
  }, false);

  bumpSecurityVersion_();
  clearAdminIndexCache_();
  try { clearFastBootSnapshot_(); } catch (_) {}

  return {
    ok: true,
    resetBy: admin.email,
    version: version,
    modules: defaults,
    savedAt: now.toISOString()
  };
}

const SUPER_ADMIN_EMAILS = Object.freeze([
  'duy.nguyenhuu01@spxexpress.com'
]);

const CACHE_CFG = Object.freeze({
  // V0.12 runtime strategy:
  // - 6h script cache for read-heavy shared models (Google max TTL)
  // - persistent compressed snapshot for small/medium models
  // - materialized period sheet for Daily KPI facts
  // - writes invalidate only the minimum affected cache
  PERMISSION_MODEL_KEY: 'spx:v01716:permission-model',
  PERMISSION_TTL_SEC: 21600,
  ADMIN_INDEX_KEY: 'spx:v140:admin-index',
  ADMIN_INDEX_TTL_SEC: 1800,
  ACCESS_KEY_PREFIX: 'spx:v01716:access',
  ACCESS_TTL_SEC: 1800,

  KPI_MODEL_KEY: 'spx:v01776:kpi-model',
  KPI_TTL_SEC: 21600,
  FORECAST_MODEL_KEY: 'spx:v140:historical-forecast-model',
  FORECAST_TTL_SEC: 21600,

  DAILY_KPI_META_KEY: 'spx:v140:daily-kpi-meta',
  DAILY_KPI_META_TTL_SEC: 21600,
  DAILY_KPI_PERIOD_PREFIX: 'spx:v141:daily-kpi-period',
  DAILY_KPI_TTL_SEC: 21600,

  TARGET_PROD_MODEL_KEY: 'spx:v168:target-prod-model',
  TARGET_PROD_TTL_SEC: 1800,
  KPI_CONFIG_MODEL_KEY: 'spx:v140:kpi-config-model',
  KPI_CONFIG_TTL_SEC: 1800,

  WRITE_LOCK_MS: 1500,
  COLD_CACHE_LOCK_MS: 150
});

const RUNTIME_CFG = Object.freeze({
  PERSIST_PREFIX: 'spx:v140:persist',
  PERSIST_CHUNK_CHARS: 8000,
  PERMISSION_PERSIST_KEY: 'permission-v01716',
  ADMIN_PERSIST_KEY: 'admin-index',
  KPI_META_PERSIST_KEY: 'kpi-meta',
  DAILY_META_PERSIST_KEY: 'daily-meta',
  KPI_MODEL_PERSIST_KEY: 'monthly-kpi-v01776',

  DAILY_FACT_PREFIX: '_SYS_KPI_FACT_',
  RUNTIME_STATUS_SHEET: '_SYS_RUNTIME',
  RUNTIME_STATUS_PROP: 'SPX_RUNTIME_STATUS_V140',
  SECURITY_VERSION_PROP: 'SPX_SECURITY_VERSION_V01716',

  FAST_WARM_HANDLER: 'warmFastRuntimeCaches',
  HEAVY_WARM_HANDLER: 'warmHeavyRuntimeCaches'
});

// Execution-scope memo: SpreadsheetApp.openById is an external service call.
// Reuse one Spreadsheet object throughout each server execution.
let __SPX_DB_MEMO = null;
let __SPX_DB_MEMO_ID = '';


/* ============================================================
   SETUP — RUN MANUALLY ONCE
   ============================================================ */

function setupApp_() {
  // Run manually once from the Apps Script editor.
  // This intentionally binds the project to ONE spreadsheet and stores its ID.
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'DB_NOT_BOUND: Không có active spreadsheet. Dùng setupAppsScript().'
    );
  }

  PropertiesService.getScriptProperties()
    .setProperty('APP_DB_SHEET_ID', active.getId());
  __SPX_DB_MEMO = active; __SPX_DB_MEMO_ID = active.getId();

  const userSheet = ensureSheet_(active, APP.USER_SHEET, APP.USER_HEADERS);
  formatUserSheet_(userSheet);
  ensureTargetProdSheets_();
  ensureRuntimeStatusSheet_();
  compactAdhocUserRows_();
  ensureSuperAdminsRecorded_();
  clearPermissionCache_(true);
  clearSecurityCaches_();

  return {
    ok: true,
    version: APP.VERSION,
    spreadsheetId: active.getId(),
    spreadsheetName: active.getName(),
    spreadsheetUrl: active.getUrl(),
    sheets: {
      admin: APP.USER_SHEET,
      permission: findPermissionSheet_(active) ? findPermissionSheet_(active).getName() : ''
    },
    superAdmins: SUPER_ADMIN_EMAILS.slice()
  };
}


/* ============================================================
   WEB APP
   ============================================================ */

function doGet() {
  // FAST HTML shell. Never scan business sheets here.
  const template=HtmlService.createTemplateFromFile('Index');
  let boot=null;
  try {
    const email=getActiveEmail_();
    if(email&&workspaceSignedOut_(email)) boot={loggedOut:true,ready:false};
    else if(email&&typeof getFastBootSnapshot_==='function') boot=getFastBootSnapshot_(email);
  } catch(_) {}
  template.boot=safeJson_(boot&&(boot.ready||boot.loggedOut)?boot:{
    app:{name:APP.NAME,subtitle:APP.SUBTITLE,version:APP.VERSION},
    shellOnly:true,ready:false,serverTime:new Date().toISOString()
  });
  return template.evaluate()
    .setTitle(APP.NAME)
    .setFaviconUrl('https://spx.vn/new_static/assets/images/favicon.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ============================================================
   FAST BOOTSTRAP
   ============================================================ */

function getLightweightKpiBootstrap_() {
  const currentMonth = Utilities.formatDate(new Date(), KPI_CFG.TIMEZONE, 'yyyy-MM');
  return {
    sheetFound:true,
    sheetName:'KPI Result',
    months:[{ value:currentMonth, label:kpiMonthLabel_(currentMonth) }],
    currentMonth:currentMonth,
    defaultMonth:currentMonth,
    metrics:KPI_CFG.METRICS.map(function(m){ return { key:m.key, label:m.label, type:m.type }; }),
    lightweight:true
  };
}

function getWorkspaceBootstrapFast(forceRefresh) {
  return getWorkspaceBootstrapSnapshotOrBuild_(forceRefresh===true);
}

function getBootstrap() {
  return getWorkspaceBootstrapFast(false);
}

/**
 * This is primarily a debug/diagnostic endpoint.
 * Scope clicks in UI do NOT need to call this every time.
 * Real data APIs should call assertScopeAccess_ internally.
 */
function validateScopeSelection(scopeType, scopeValue) {
  const access = requireAccess_();
  return {
    ok: true,
    scope: assertScopeAccess_(access, scopeType, scopeValue),
    serverTime: new Date().toISOString()
  };
}

function debugMyAccess() {
  const access = requireAccess_();

  return {
    email: access.email,
    rank: access.rank,
    assignedType: access.assignedType,
    assignedValue: access.assignedValue,
    allowed: access.allowed,
    isAdmin: access.isAdmin,
    scope: buildScopeContext_(access),
    drill: buildDrillContext_(access)
  };
}

function refreshSecurityCache() {
  const admin = requireAdmin_();
  clearSecurityCaches_();
  const permission = getPermissionModel_(true);
  const adhocUsers = readAdhocAdminsDirect_(true);

  return {
    ok: true,
    refreshedBy: admin.email,
    adhocCount: adhocUsers.length,
    permissionUserCount: Object.keys(permission.users || {}).length,
    stationCount: (permission.stations || []).length,
    serverTime: new Date().toISOString()
  };
}


/* ============================================================
   ADMIN — USERS
   ============================================================ */

function getAdhocUsers(forceRefresh, includeDeleted) {
  requireAdmin_();
  ensureSuperAdminsRecorded_();

  return readAdhocAdminsDirect_(
    includeDeleted === true
  );
}


function readAdhocAdminsDirect_(includeDeleted) {
  const sheet =
    getRequiredSheet_(APP.USER_SHEET);

  const maxRows =
    sheet.getMaxRows();

  if (maxRows < 2) {
    return [];
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        maxRows - 1,
        APP.USER_HEADERS.length
      )
      .getValues()
      .filter(function(r) {
        return normalizeEmail_(r[0]);
      })
      .map(rowToUserObject_)
      .filter(function(u) {
        return (
          u.role === 'ADMIN' ||
          u.role === 'NORMAL'
        );
      });

  if (includeDeleted === true) {
    return rows;
  }

  return rows.filter(function(u) {
    return (
      String(u.source || '')
        .toUpperCase() !== 'ADHOC_DELETED'
    );
  });
}

function saveAdhocUser(payload) {
  const admin =
    requireAdmin_();

  payload =
    payload || {};

  const email =
    normalizeEmail_(
      payload.email
    );

  if (
    !isValidEmail_(email)
  ) {
    throw new Error(
      'Email không hợp lệ.'
    );
  }

  const found =
    findUserRowByEmailDirect_(email);

  let role =
    String(
      payload.role ||
      (
        found
          ? found.values[2]
          : 'NORMAL'
      ) ||
      'NORMAL'
    )
      .trim()
      .toUpperCase();

  if (
    role !== 'ADMIN' &&
    role !== 'NORMAL'
  ) {
    throw new Error(
      'ROLE_INVALID: chỉ hỗ trợ ADMIN hoặc NORMAL.'
    );
  }

  if (
    isSuperAdminEmail_(email)
  ) {
    role = 'ADMIN';
  }

  const displayName =
    cleanText_(
      payload.displayName ||
      (
        found &&
        found.values[1]
      ) ||
      displayNameFromEmail_(email),
      120
    );

  const note =
    cleanText_(
      payload.note,
      500
    );

  const active =
    isSuperAdminEmail_(email)
      ? true
      : payload.active !== false;

  let source;

  if (
    isSuperAdminEmail_(email)
  ) {
    source =
      'SUPER_ADMIN';

  } else if (
    !found
  ) {
    source =
      role === 'ADMIN'
        ? 'ACCOUNT_ADMIN_CREATED'
        : 'ACCOUNT_NORMAL_CREATED';

  } else {
    const previousActive =
      toBool_(found.values[5]);

    const previousRole =
      String(
        found.values[2] ||
        'NORMAL'
      )
        .trim()
        .toUpperCase();

    if (
      previousRole !== role
    ) {
      source =
        'ACCOUNT_ROLE_UPDATED';

    } else if (
      previousActive !== active
    ) {
      source =
        active
          ? 'ACCOUNT_ENABLED'
          : 'ACCOUNT_DISABLED';

    } else {
      source =
        'ACCOUNT_UPDATED';
    }
  }

  return withShortWriteLock_(
    function() {
      const result =
        upsertAdminRecord_(
          email,
          {
            displayName:
              displayName,

            role:
              role,

            active:
              active,

            source:
              source,

            note:
              note,

            preserveCreatedAt:
              true
          }
        );

      compactAdhocUserRows_();
      clearSecurityCaches_();

      const verify =
        findUserRowByEmailDirect_(
          email
        );

      if (!verify) {
        throw new Error(
          'WRITE_VERIFY_FAILED: account was not found in physical Adhoc user after save.'
        );
      }

      const db =
        getDb_();

      return {
        ok:true,
        email:email,
        role:role,
        rank:role,
        active:active,
        source:source,
        isSuperAdmin:
          isSuperAdminEmail_(email),
        changedBy:
          admin.email,
        updatedAt:
          result.updatedAt,
        sheetRow:
          verify.row,
        spreadsheetId:
          db.getId(),
        spreadsheetName:
          db.getName()
      };
    }
  );
}

function setAdhocUserActive(email, active) {
  const admin =
    requireAdmin_();

  email =
    normalizeEmail_(email);

  if (
    !isValidEmail_(email)
  ) {
    throw new Error(
      'Email không hợp lệ.'
    );
  }

  if (
    isSuperAdminEmail_(email)
  ) {
    throw new Error(
      'SUPER_ADMIN_PROTECTED: Không thể Disable Super Admin.'
    );
  }

  if (
    email === admin.email &&
    active === false
  ) {
    throw new Error(
      'Không thể tự Disable chính ADMIN đang đăng nhập.'
    );
  }

  return withShortWriteLock_(
    function() {
      const found =
        findUserRowByEmailDirect_(
          email
        );

      if (!found) {
        throw new Error(
          'Không tìm thấy account trong Adhoc user.'
        );
      }

      let role =
        String(
          found.values[2] ||
          'NORMAL'
        )
          .trim()
          .toUpperCase();

      if (
        role !== 'ADMIN' &&
        role !== 'NORMAL'
      ) {
        role = 'NORMAL';
      }

      const now =
        new Date();

      const sheet =
        getRequiredSheet_(
          APP.USER_SHEET
        );

      const source =
        Boolean(active)
          ? 'ACCOUNT_ENABLED'
          : 'ACCOUNT_DISABLED';

      sheet
        .getRange(
          found.row,
          3,
          1,
          8
        )
        .setValues([[
          role,
          role === 'ADMIN'
            ? 'CITY'
            : 'MODULES',
          role === 'ADMIN'
            ? APP.CITY_VALUE
            : '',
          Boolean(active),
          source,
          found.values[7] || '',
          found.values[8] || now,
          now
        ]]);

      compactAdhocUserRows_();
      clearSecurityCaches_();

      return {
        ok:true,
        email:email,
        role:role,
        active:Boolean(active),
        source:source,
        changedBy:admin.email,
        updatedAt:now.toISOString()
      };
    }
  );
}

function deleteAdhocUser(email) {
  const admin =
    requireAdmin_();

  email =
    normalizeEmail_(email);

  if (
    !isValidEmail_(email)
  ) {
    throw new Error(
      'Email không hợp lệ.'
    );
  }

  if (
    isSuperAdminEmail_(email)
  ) {
    throw new Error(
      'SUPER_ADMIN_PROTECTED: Không thể Delete Super Admin.'
    );
  }

  if (
    email === admin.email
  ) {
    throw new Error(
      'Không thể xóa chính ADMIN đang đăng nhập.'
    );
  }

  return withShortWriteLock_(
    function() {
      const found =
        findUserRowByEmailDirect_(
          email
        );

      if (!found) {
        return {
          ok:true,
          deleted:false
        };
      }

      let role =
        String(
          found.values[2] ||
          'NORMAL'
        )
          .trim()
          .toUpperCase();

      if (
        role !== 'ADMIN' &&
        role !== 'NORMAL'
      ) {
        role = 'NORMAL';
      }

      const now =
        new Date();

      const sheet =
        getRequiredSheet_(
          APP.USER_SHEET
        );

      sheet
        .getRange(
          found.row,
          3,
          1,
          8
        )
        .setValues([[
          role,
          role === 'ADMIN'
            ? 'CITY'
            : 'MODULES',
          role === 'ADMIN'
            ? APP.CITY_VALUE
            : '',
          false,
          'ADHOC_DELETED',
          found.values[7] || '',
          found.values[8] || now,
          now
        ]]);

      compactAdhocUserRows_();
      clearSecurityCaches_();

      return {
        ok:true,
        deleted:true,
        softDeleted:true,
        email:email,
        role:role,
        changedBy:admin.email,
        updatedAt:now.toISOString()
      };
    }
  );
}


function getDeletedAdhocAdmins() {
  return getAdhocUsers(
    true,
    true
  ).filter(function(u) {
    return (
      String(u.source || '')
        .toUpperCase() === 'ADHOC_DELETED'
    );
  });
}


/* ============================================================
   AUTH
   ============================================================ */

function getActiveEmail_() {
  return normalizeEmail_(
    Session.getActiveUser().getEmail()
  );
}

function requireAccess_(pages) {
  const email = getActiveEmail_();

  if (!email) {
    throw new Error('AUTH_EMAIL_UNAVAILABLE');
  }

  if(workspaceSignedOut_(email))throw new Error('WORKSPACE_SIGNED_OUT');

  const access = getUserAccessByEmail_(email);

  if (!access.allowed) {
    throw new Error('ACCESS_DENIED');
  }

  if(typeof assertPageAccess_==='function')assertPageAccess_(access,pages);

  return access;
}

function workspaceSignOutKey_(email){return 'SPX_WORKSPACE_SIGNED_OUT:'+normalizeEmail_(email)}
function workspaceSignedOut_(email){return !!email&&PropertiesService.getUserProperties().getProperty(workspaceSignOutKey_(email))==='1'}
function signOutWorkspace(){
  const email=getActiveEmail_();if(!email)throw new Error('AUTH_EMAIL_UNAVAILABLE');
  PropertiesService.getUserProperties().setProperty(workspaceSignOutKey_(email),'1');
  if(typeof clearFastBootSnapshot_==='function')clearFastBootSnapshot_();
  return {ok:true};
}
function signInWorkspace(){
  const email=getActiveEmail_();if(!email)throw new Error('AUTH_EMAIL_UNAVAILABLE');
  const access=getUserAccessByEmail_(email);if(!access.allowed)throw new Error('ACCESS_DENIED');
  PropertiesService.getUserProperties().deleteProperty(workspaceSignOutKey_(email));
  return {ok:true};
}

function requireAdmin_() {
  const access = requireAccess_();

  if (access.rank !== 'ADMIN') {
    throw new Error(
      `ADMIN_REQUIRED: current rank = ${access.rank}`
    );
  }

  return toPublicUser_(access);
}

function getUserAccessByEmail_(email) {
  email =
    normalizeEmail_(email);

  if (!email) {
    return {
      allowed:false,
      email:''
    };
  }

  // SUPER ADMIN is always full ADMIN.
  if (
    isSuperAdminEmail_(email)
  ) {
    return {
      allowed:true,
      email:email,
      displayName:
        displayNameFromEmail_(email),
      role:'ADMIN',
      rank:'ADMIN',
      assignedType:'CITY',
      assignedValue:
        APP.CITY_VALUE,
      hubCodes:[],
      hubNames:[],
      stations:[],
      isAdmin:true,
      isSuperAdmin:true,
      source:'SUPER_ADMIN'
    };
  }

  const version =
    getSecurityVersion_();

  const cacheKey =
    CACHE_CFG.ACCESS_KEY_PREFIX +
    ':' +
    version +
    ':' +
    email;

  const cache =
    CacheService
      .getScriptCache();

  try {
    const cached =
      cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }
  } catch (_) {}

  let access = null;

  // Managed account lookup has priority over Permission.
  // This is intentional:
  // - ADMIN gets full internal app access.
  // - NORMAL is module-only and must NOT inherit SUP/AOM/Lead permissions
  //   even if the same email exists in Permission.
  const accounts =
    getAdhocAdminIndex_(false);

  const account =
    accounts[email];

  if (
    account &&
    String(
      account.source ||
      ''
    ).toUpperCase() !== 'ADHOC_DELETED'
  ) {
    if (!account.active) {
      access = {
        allowed:false,
        email:email,
        displayName:
          account.displayName ||
          displayNameFromEmail_(email),
        role:
          account.role ||
          'NORMAL',
        rank:
          account.rank ||
          account.role ||
          'NORMAL',
        isAdmin:false,
        isSuperAdmin:false,
        source:
          account.source ||
          'ACCOUNT_DISABLED',
        managedAccount:true
      };

    } else if (
      String(
        account.role ||
        ''
      ).toUpperCase() === 'ADMIN'
    ) {
      access = {
        allowed:true,
        email:email,
        displayName:
          account.displayName ||
          displayNameFromEmail_(email),
        role:'ADMIN',
        rank:'ADMIN',
        assignedType:'CITY',
        assignedValue:
          APP.CITY_VALUE,
        hubCodes:[],
        hubNames:[],
        stations:[],
        isAdmin:true,
        isSuperAdmin:false,
        source:
          account.source ||
          'ACCOUNT_ADMIN',
        managedAccount:true
      };

    } else {
      access = {
        allowed:true,
        email:email,
        displayName:
          account.displayName ||
          displayNameFromEmail_(email),
        role:'NORMAL',
        rank:'NORMAL',
        assignedType:'MODULES',
        assignedValue:'',
        hubCodes:[],
        hubNames:[],
        stations:[],
        isAdmin:false,
        isSuperAdmin:false,
        source:
          account.source ||
          'ACCOUNT_NORMAL',
        managedAccount:true
      };
    }
  }

  // Explicit non-admin grants replace mapped HUB scope. Existing disabled
  // managed accounts and all Admin accounts keep their original precedence.
  if(typeof getCustomAccessGrant_==='function'&&(!access||!access.isAdmin)&&(!account||account.active||String(account.source||'').toUpperCase()==='ADHOC_DELETED')){
    const grant=getCustomAccessGrant_(email);if(grant)access=customGrantAccess_(grant);
  }

  // Deleted managed account records no longer override Permission.
  // A user with a normal Permission role can fall back to Permission
  // after the managed account is deleted.
  if (
    !access &&
    (
      !account ||
      String(
        account.source ||
        ''
      ).toUpperCase() === 'ADHOC_DELETED'
    )
  ) {
    access =
      getPermissionAccessByEmail_(
        email
      );

    if (access) {
      access.isSuperAdmin = false;
    }
  }

  if (!access) {
    access = {
      allowed:false,
      email:email
    };
  }

  try {
    cache.put(
      cacheKey,
      JSON.stringify(access),
      CACHE_CFG.ACCESS_TTL_SEC
    );
  } catch (_) {}

  return access;
}



function clearUserCache_(email) {
  // Versioned access keys make old cached grants unreachable immediately
  // after an app-managed authorization change.
  bumpSecurityVersion_();
  clearAdminIndexCache_();
}



function toPublicUser_(access) {
  return {
    email: access.email,
    name: access.displayName,
    role: access.role,
    rank: access.rank,
    scopeType: access.assignedType,
    scopeValue: access.assignedValue,
    hubCodes: access.hubCodes || [],
    hubNames: access.hubNames || [],
    stations: access.stations || [],
    isAdmin: access.isAdmin,
    isSuperAdmin: Boolean(access.isSuperAdmin),
    source: access.source || '',
    customAccess:Boolean(access.customAccess),
    permissionProfile:access.permissionProfile||'',
    allowedPages:access.customAccess?(access.allowedPages||[]).slice():null
  };
}

function toPublicAccess_(access, permissionModel) {
  access =
    access || {};

  const rank =
    normalizeRank_(
      access.rank
    );

  // NORMAL accounts are module-only and deliberately have no HUB scope.
  if (rank === 'NORMAL') {
    return {
      rank:'NORMAL',
      authSource:
        access.source || '',
      allData:false,
      isAdmin:false,
      isSuperAdmin:false,
      moduleOnly:true,
      allowedHubCodes:[],
      stationCount:0
    };
  }

  const permission =
    permissionModel ||
    getPermissionModel_(false);

  return {
    rank:
      access.rank,

    authSource:
      access.source || '',

    allData:
      Boolean(
        access.isAdmin
      ),

    isAdmin:
      Boolean(
        access.isAdmin
      ),

    isSuperAdmin:
      Boolean(
        access.isSuperAdmin
      ),

    moduleOnly:false,
    customAccess:Boolean(access.customAccess),
    permissionProfile:access.permissionProfile||'',
    allowedPages:access.customAccess?(access.allowedPages||[]).slice():null,

    allowedHubCodes:
      access.isAdmin
        ? []
        : (
            access.hubCodes ||
            []
          ).slice(),

    stationCount:
      access.isAdmin
        ? (
            permission.stations ||
            []
          ).length
        : (
            access.hubCodes ||
            []
          ).length
  };
}



/* ============================================================
   PERMISSION SHEET ENGINE — V6.3
   ------------------------------------------------------------
   ADMIN = Adhoc user (absolute priority)
   SAOM  = Permission[SAOM]
   AOM   = Permission[AOM]
   SUP   = Permission[Sup]
   HUB   = any Permission column whose normalized header starts with "lead"

   IMPORTANT SECURITY RULE:
   If one email appears in more than one role, highest rank wins,
   BUT station access is taken only from that highest-rank column.
   Any header beginning with "lead" grants HUB scope for that station. Highest-rank logic still prevents Lead membership from expanding AOM/SUP scope.
   ============================================================ */

function getPermissionModel_(forceRefresh) {
  if (forceRefresh === true) {
    clearPermissionCache_(true);
  }

  const cached = getChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY);
  if (cached) return cached;

  // Persistent compressed fallback prevents a cold CacheService eviction from
  // forcing a Permission Sheet scan during user login.
  const persisted = getPersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY);
  if (persisted && forceRefresh !== true) {
    putChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY, persisted, CACHE_CFG.PERMISSION_TTL_SEC);
    return persisted;
  }

  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(CACHE_CFG.COLD_CACHE_LOCK_MS);
    if (locked) {
      const retry = getChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY);
      if (retry) return retry;
      const retryPersisted = getPersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY);
      if (retryPersisted && forceRefresh !== true) return retryPersisted;

      const built = buildPermissionModel_();
      putChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY, built, CACHE_CFG.PERMISSION_TTL_SEC);
      putPersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY, built);
      bumpSecurityVersion_();
      return built;
    }
  } finally {
    if (locked) lock.releaseLock();
  }

  // Never launch duplicate expensive cold builds when another execution owns
  // the lock. One short retry; if no cache exists, build as last resort.
  Utilities.sleep(40);
  const retry = getChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY) ||
                getPersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY);
  if (retry) return retry;

  const built = buildPermissionModel_();
  putChunkedCacheJson_(CACHE_CFG.PERMISSION_MODEL_KEY, built, CACHE_CFG.PERMISSION_TTL_SEC);
  putPersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY, built);
  return built;
}


function findPermissionSheet_(ss) {
  const aliases = (APP.PERMISSION_SHEET_ALIASES || [APP.PERMISSION_SHEET])
    .map(name => normalizeCompare_(name));

  // Exact name first, then case-insensitive aliases.
  const exact = ss.getSheetByName(APP.PERMISSION_SHEET);
  if (exact) return exact;

  return ss.getSheets().find(function(sh) {
    return aliases.indexOf(normalizeCompare_(sh.getName())) !== -1;
  }) || null;
}

function permissionHeaderIndexAny_(headerMap, aliases) {
  for (let i = 0; i < (aliases || []).length; i++) {
    const idx = headerMap[normalizePermissionHeader_(aliases[i])];
    if (idx !== undefined) return idx;
  }
  return -1;
}

function permissionCellAny_(row, headerMap, aliases) {
  const idx = permissionHeaderIndexAny_(headerMap, aliases);
  if (idx < 0) return '';
  const text = String(row[idx] || '').trim();
  if (!text || text === '-' || text.toLowerCase() === 'n/a') return '';
  return text;
}

function mergeEmailList_(target, incoming) {
  const seen = {};
  (target || []).forEach(function(email) { seen[normalizeEmail_(email)] = true; });
  (incoming || []).forEach(function(email) {
    email = normalizeEmail_(email);
    if (!email || seen[email]) return;
    seen[email] = true;
    target.push(email);
  });
  return target;
}

function permissionStationName_(row, map) {
  return permissionCellAny_(row, map, [
    'hub',
    'hub name',
    'station name',
    'profile station',
    'profit station'
  ]);
}

function permissionStationCode_(row, map, stationName) {
  return permissionCellAny_(row, map, [
    'hub code',
    'station code',
    'profit station code'
  ]) || stationName;
}


/**
 * Build exact scope display names from Permission[Employee Name].
 *
 * The current Permission schema does not have a direct Employee Email column.
 * Role columns (SAOM/AOM/Sup/Lead*) contain emails while Employee Name is the
 * canonical human name. We therefore match the email local-part to Employee
 * Name using normalized Vietnamese tokens. The original sheet spelling/case is
 * preserved in the UI once a confident match is found.
 */
function normalizePersonText_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function personTokens_(value) {
  const text = normalizePersonText_(value);
  return text ? text.split(/\s+/).filter(Boolean) : [];
}

function emailLocalTokens_(email) {
  email = normalizeEmail_(email);
  const local = String(email || '').split('@')[0] || '';
  return local
    .replace(/\d+$/g, '')
    .split(/[._-]+/)
    .map(function(x){ return normalizePersonText_(x).replace(/\s+/g, ''); })
    .filter(Boolean);
}

function personTokenVariants_(name) {
  const tokens = personTokens_(name);
  const set = {};

  function add(v) {
    v = String(v || '').replace(/[^a-z0-9]/g, '');
    if (v) set[v] = true;
  }

  tokens.forEach(add);

  // Common email conventions concatenate 2-3 Vietnamese name tokens in
  // different orders, e.g. "duc.trinhhoang" for "TRỊNH HOÀNG ĐỨC".
  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (j === i) continue;
      add(tokens[i] + tokens[j]);
      for (let k = 0; k < tokens.length; k++) {
        if (k === i || k === j) continue;
        add(tokens[i] + tokens[j] + tokens[k]);
      }
    }
  }

  add(tokens.join(''));
  add(tokens.slice().reverse().join(''));
  return set;
}

function permissionNameMatchScore_(email, employeeName) {
  const emailTokens = emailLocalTokens_(email);
  const nameTokens = personTokens_(employeeName);
  if (!emailTokens.length || !nameTokens.length) return 0;

  const variants = personTokenVariants_(employeeName);
  let matched = 0;
  let charMatched = 0;

  emailTokens.forEach(function(token) {
    if (variants[token]) {
      matched += 1;
      charMatched += token.length;
      return;
    }

    // Allow long local-part segments contained inside a normalized full name.
    if (token.length >= 4) {
      const fullA = nameTokens.join('');
      const fullB = nameTokens.slice().reverse().join('');
      if (fullA.indexOf(token) !== -1 || fullB.indexOf(token) !== -1) {
        matched += 1;
        charMatched += token.length;
      }
    }
  });

  if (matched !== emailTokens.length) return 0;

  // Prefer candidates explaining more characters and more email segments.
  return matched * 1000 + charMatched * 10 - Math.abs(nameTokens.length - emailTokens.length);
}

function buildPermissionEmployeeNameDirectory_(values, headerInfo, roleEmails) {
  const map = headerInfo.headerMap || {};
  const employeeNameIdx = map[normalizePermissionHeader_('Employee Name')];
  if (employeeNameIdx === undefined) return {};

  const uniqueNames = {};
  for (let r = headerInfo.rowIndex + 1; r < values.length; r++) {
    const name = String((values[r] || [])[employeeNameIdx] || '').trim();
    if (!name || name === '-') continue;
    const key = normalizePersonText_(name);
    if (key && !uniqueNames[key]) uniqueNames[key] = name;
  }

  const names = Object.keys(uniqueNames).map(function(k){ return uniqueNames[k]; });
  const out = {};

  (roleEmails || []).forEach(function(email) {
    email = normalizeEmail_(email);
    if (!email) return;

    let best = null;
    let secondScore = 0;

    names.forEach(function(name) {
      const score = permissionNameMatchScore_(email, name);
      if (!score) return;
      if (!best || score > best.score) {
        secondScore = best ? best.score : secondScore;
        best = { displayName:name, score:score };
      } else if (score > secondScore) {
        secondScore = score;
      }
    });

    // Only accept an unambiguous confident match. Otherwise we retain the
    // existing email-derived fallback rather than showing the wrong employee.
    if (best && best.score >= 1020 && best.score > secondScore) {
      out[email] = {
        displayName:best.displayName,
        source:'PERMISSION_EMPLOYEE_NAME',
        confidence:best.score
      };
    }
  });

  return out;
}

function permissionRoleEmailsFromStations_(stations) {
  const seen = {};
  const out = [];
  function add(email) {
    email = normalizeEmail_(email);
    if (!email || seen[email]) return;
    seen[email] = true;
    out.push(email);
  }

  (stations || []).forEach(function(s) {
    (s.saom || []).forEach(add);
    (s.aom || []).forEach(add);
    (s.sup || []).forEach(add);
    (s.leadEmails || []).forEach(add);
  });

  return out;
}

function permissionDisplayNameForEmail_(email, model) {
  email = normalizeEmail_(email);
  if (!email) return '';
  model = model || getPermissionModel_(false);
  const user = model && model.users ? model.users[email] : null;
  return (user && user.displayName) || displayNameFromEmail_(email);
}

function buildPermissionModel_() {
  const ss = getDb_();
  const sheet = findPermissionSheet_(ss);

  if (!sheet) {
    return {
      sheetFound:false,
      expectedSheetNames:
        APP.PERMISSION_SHEET_ALIASES ||
        [APP.PERMISSION_SHEET],
      generatedAt:
        new Date().toISOString(),
      headerRow:0,
      permissionPeriod:'',
      stationCount:0,
      stations:[],
      users:{}
    };
  }

  // One raw read. This keeps KPI Period as Date when the source cell is a date.
  const values =
    sheet.getDataRange().getValues();

  const headerInfo =
    findPermissionHeader_(values);

  if (!headerInfo) {
    throw new Error(
      'PERMISSION_HEADER_NOT_FOUND: expected "Hub" / "Hub Name" / "Station Name" / "Profile Station" in sheet "' +
      sheet.getName() +
      '".'
    );
  }

  const headers =
    headerInfo.headers;

  const map =
    headerInfo.headerMap;

  const leadColumns =
    getLeadColumns_(headers);

  // If Permission contains multiple snapshots, use only the latest KPI Period.
  const periodIdx =
    permissionHeaderIndexAny_(
      map,
      ['kpi period', 'period']
    );

  let permissionPeriod = '';

  if (periodIdx >= 0) {
    const periodKeys = [];

    for (
      let r = headerInfo.rowIndex + 1;
      r < values.length;
      r++
    ) {
      const key =
        sourceDateKey_(
          (values[r] || [])[periodIdx]
        );

      if (key) {
        periodKeys.push(key);
      }
    }

    periodKeys.sort(
      factSortDateDesc_
    );

    permissionPeriod =
      periodKeys[0] || '';
  }

  const stationWork = {};

  for (
    let r = headerInfo.rowIndex + 1;
    r < values.length;
    r++
  ) {
    const row = values[r];

    if (
      permissionPeriod &&
      periodIdx >= 0
    ) {
      const rowPeriod =
        sourceDateKey_(row[periodIdx]);

      if (
        rowPeriod !== permissionPeriod
      ) {
        continue;
      }
    }

    const hubName =
      permissionStationName_(row, map);

    if (!hubName) continue;

    const hubCode =
      permissionStationCode_(
        row,
        map,
        hubName
      );

    const stationKey =
      normalizeCompare_(
        hubCode || hubName
      );

    if (!stationKey) continue;

    if (!stationWork[stationKey]) {
      stationWork[stationKey] = {
        rowNumber:r + 1,
        sourceRowCount:0,

        no:permissionCellAny_(
          row,
          map,
          ['no.', 'no']
        ),

        hubCode:hubCode,
        hubName:hubName,

        type:permissionCellAny_(
          row,
          map,
          ['type', 'hub type']
        ),

        address:permissionCellAny_(
          row,
          map,
          ['address']
        ),

        ward:permissionCellAny_(
          row,
          map,
          ['ward (new)', 'ward']
        ),

        sqm:permissionCellAny_(
          row,
          map,
          ['sqm']
        ),

        lat:permissionCellAny_(
          row,
          map,
          ['lat', 'latitude']
        ),

        long:permissionCellAny_(
          row,
          map,
          ['long', 'longitude', 'lng']
        ),

        district:permissionCellAny_(
          row,
          map,
          [
            'by district',
            'dist. (old)',
            'district'
          ]
        ),

        zone:permissionCellAny_(
          row,
          map,
          ['zone']
        ),

        saom:[],
        aom:[],
        sup:[],
        leads:{},
        leadEmails:[]
      };
    }

    const station =
      stationWork[stationKey];

    station.sourceRowCount += 1;

    mergeEmailList_(
      station.saom,
      extractEmails_(
        permissionCellAny_(
          row,
          map,
          ['saom', 'senior aom']
        )
      )
    );

    mergeEmailList_(
      station.aom,
      extractEmails_(
        permissionCellAny_(
          row,
          map,
          ['aom']
        )
      )
    );

    mergeEmailList_(
      station.sup,
      extractEmails_(
        permissionCellAny_(
          row,
          map,
          ['sup', 'supervisor']
        )
      )
    );

    leadColumns.forEach(function(col) {
      if (!station.leads[col.header]) {
        station.leads[col.header] = [];
      }

      const emails =
        extractEmails_(
          row[col.index]
        );

      mergeEmailList_(
        station.leads[col.header],
        emails
      );

      mergeEmailList_(
        station.leadEmails,
        emails
      );
    });
  }

  const stations =
    Object.keys(stationWork)
      .map(function(key) {
        return stationWork[key];
      })
      .sort(function(a, b) {
        return String(a.hubName)
          .localeCompare(
            String(b.hubName)
          );
      });

  // Current Permission may not contain Employee Name.
  // Existing engine already falls back safely to email-derived display names.
  const roleEmails =
    permissionRoleEmailsFromStations_(
      stations
    );

  const employeeDirectory =
    buildPermissionEmployeeNameDirectory_(
      values,
      headerInfo,
      roleEmails
    );

  return {
    sheetFound:true,
    sheetName:sheet.getName(),

    schema:
      permissionPeriod
        ? 'STATION_GRAIN_KPI_PERIOD'
        : 'STATION_GRAIN',

    generatedAt:
      new Date().toISOString(),

    headerRow:
      headerInfo.rowIndex + 1,

    permissionPeriod:
      permissionPeriod,

    stationCount:
      stations.length,

    physicalPermissionRows:
      Math.max(
        0,
        values.length -
        headerInfo.rowIndex -
        1
      ),

    leadHeaders:
      leadColumns.map(function(col) {
        return col.header;
      }),

    stations:stations,
    employeeDirectory:
      employeeDirectory,

    // IMPORTANT:
    // Existing rank engine is untouched:
    // SAOM > AOM > SUP > HUB/Lead.
    users:
      buildPermissionUsers_(
        stations,
        employeeDirectory
      )
  };
}

function getLeadColumns_(headers) {
  const out = [];
  (headers || []).forEach(function(header, index) {
    const normalized = normalizePermissionHeader_(header);
    if (normalized.substring(0, 4) === 'lead') {
      out.push({ header: String(header || '').trim(), index: index });
    }
  });
  return out;
}

function findPermissionHeader_(values) {
  const maxRows = Math.min(values.length, 50);
  const stationAliases = ['hub', 'hub name', 'station name', 'profile station', 'profit station'];

  for (let r = 0; r < maxRows; r++) {
    const headers = (values[r] || []).map(function(v) {
      return String(v == null ? '' : v).trim();
    });
    const normalized = headers.map(normalizePermissionHeader_);
    const hasStation = stationAliases.some(function(alias) {
      return normalized.indexOf(normalizePermissionHeader_(alias)) !== -1;
    });
    if (!hasStation) continue;

    const headerMap = {};
    headers.forEach(function(header, index) {
      const key = normalizePermissionHeader_(header);
      // Permission currently contains Hub Code twice. First column wins.
      if (key && headerMap[key] === undefined) headerMap[key] = index;
    });

    return { rowIndex:r, headers:headers, headerMap:headerMap };
  }

  return null;
}

function normalizePermissionHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function permissionCell_(row, headerMap, headerName) {
  const index = headerMap[normalizePermissionHeader_(headerName)];
  if (index === undefined) return '';
  const text = String(row[index] || '').trim();
  if (!text || text === '-' || text.toLowerCase() === 'n/a') return '';
  return text;
}

function extractEmails_(value) {
  const text = String(value || '').toLowerCase();
  if (!text || text === '-') return [];

  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  const seen = {};

  return matches
    .map(normalizeEmail_)
    .filter(function(email) {
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    });
}

function buildPermissionUsers_(stations, employeeDirectory) {
  employeeDirectory = employeeDirectory || {};
  const work = {};

  function bucket(email) {
    email = normalizeEmail_(email);
    if (!email) return null;
    if (!work[email]) {
      work[email] = {
        email:email,
        SAOM:{},
        AOM:{},
        SUP:{},
        HUB:{}
      };
    }
    return work[email];
  }

  function add(email, role, station) {
    const user = bucket(email);
    if (!user) return;
    user[role][station.hubCode] = station;
  }

  stations.forEach(function(station) {
    (station.saom || []).forEach(function(email) { add(email, 'SAOM', station); });
    (station.aom || []).forEach(function(email) { add(email, 'AOM', station); });
    (station.sup || []).forEach(function(email) { add(email, 'SUP', station); });
    (station.leadEmails || []).forEach(function(email) { add(email, 'HUB', station); });
  });

  const out = {};
  Object.keys(work).forEach(function(email) {
    const w = work[email];

    // Permission priority inside Permission sheet:
    // SAOM > AOM > SUP > HUB.
    // IMPORTANT: only stations assigned at the winning rank are used. Lower
    // role appearances must never expand the user's scope.
    let rank = 'HUB';
    if (Object.keys(w.SAOM).length) rank = 'SAOM';
    else if (Object.keys(w.AOM).length) rank = 'AOM';
    else if (Object.keys(w.SUP).length) rank = 'SUP';

    const sourceMap = w[rank];
    const assignedStations = Object.keys(sourceMap)
      .map(function(code) { return sourceMap[code]; })
      .sort(function(a,b) { return String(a.hubName).localeCompare(String(b.hubName)); });

    const nameInfo = employeeDirectory[email] || null;
    out[email] = {
      email:email,
      displayName:nameInfo ? nameInfo.displayName : displayNameFromEmail_(email),
      displayNameSource:nameInfo ? nameInfo.source : 'EMAIL_FALLBACK',
      rank:rank,
      hubCodes:assignedStations.map(function(s) { return s.hubCode; }),
      hubNames:assignedStations.map(function(s) { return s.hubName; }),
      stations:assignedStations.map(permissionStationSummary_)
    };
  });

  return out;
}

function permissionStationSummary_(station) {
  return {
    hubCode: station.hubCode,
    hubName: station.hubName,
    type: station.type,
    zone: station.zone,
    district: station.district,
    address: station.address,
    ward: station.ward,
    sqm: station.sqm,
    lat: station.lat,
    long: station.long
  };
}

function getPermissionAccessByEmail_(email) {
  email = normalizeEmail_(email);
  if (!email) return null;

  const model = getPermissionModel_(false);
  const user = (model.users || {})[email];
  if (!user) return null;

  return {
    allowed: true,
    email: email,
    displayName: user.displayName || displayNameFromEmail_(email),
    role: 'AUTO_PERMISSION',
    rank: user.rank,
    assignedType: user.rank,
    assignedValue: (user.hubCodes || []).join(';'),
    hubCodes: user.hubCodes || [],
    hubNames: user.hubNames || [],
    stations: user.stations || [],
    isAdmin: false,
    source: 'PERMISSION'
  };
}

function getPermissionAdminView(forceRefresh) {
  requireAdmin_();
  const model = getPermissionModel_(forceRefresh === true);

  const users = Object.keys(model.users || {})
    .map(function(email) {
      const u = model.users[email];
      return {
        email: u.email,
        displayName:u.displayName || displayNameFromEmail_(u.email),
        displayNameSource:u.displayNameSource || 'EMAIL_FALLBACK',
        rank: u.rank,
        hubCount: (u.hubCodes || []).length,
        hubCodes: u.hubCodes || [],
        hubNames: u.hubNames || [],
        stations: u.stations || []
      };
    })
    .sort(function(a, b) {
      const p = {SAOM: 1, AOM: 2, SUP: 3, HUB: 4};
      return (p[a.rank] - p[b.rank]) || a.email.localeCompare(b.email);
    });

  return {
    ok: true,
    sheetFound: model.sheetFound !== false,
    sheetName: model.sheetName || '',
    expectedSheetNames: model.expectedSheetNames || (APP.PERMISSION_SHEET_ALIASES || [APP.PERMISSION_SHEET]),
    generatedAt: model.generatedAt || '',
    headerRow: model.headerRow || 0,
    stationCount: (model.stations || []).length,
    leadHeaders: model.leadHeaders || [],
    userCount: users.length,
    users: users,
    stations: (model.stations || []).map(function(s) {
      return {
        no: s.no,
        hubCode: s.hubCode,
        hubName: s.hubName,
        type: s.type,
        address: s.address,
        ward: s.ward,
        sqm: s.sqm,
        lat: s.lat,
        long: s.long,
        district: s.district,
        zone: s.zone,
        saom: s.saom || [],
        aom: s.aom || [],
        sup: s.sup || [],
        leads: s.leads || {},
        leadEmails: s.leadEmails || []
      };
    })
  };
}

function permissionUsersByRank_(model, rank) {
  return Object.keys(model.users || {})
    .map(email => model.users[email])
    .filter(u => u.rank === rank);
}

function stationByHubCode_(model, hubCode) {
  const key = normalizeCompare_(hubCode);
  return (model.stations || []).find(s => normalizeCompare_(s.hubCode) === key) || null;
}

function permissionUserScopeOption_(u, prefix) {
  const name = (u && u.displayName) || displayNameFromEmail_(u && u.email);
  return {
    value:u.email,
    label:(prefix ? prefix + ' • ' : '') + name,
    displayName:name,
    email:u.email,
    hubCount:(u.hubCodes || []).length
  };
}


function debugPermissionEmployeeNames() {
  requireAdmin_();
  const model = getPermissionModel_(true);
  const users = Object.keys(model.users || {}).map(function(email) {
    const u = model.users[email];
    return {
      rank:u.rank,
      email:u.email,
      displayName:u.displayName,
      source:u.displayNameSource,
      hubCount:(u.hubCodes || []).length
    };
  }).sort(function(a,b) {
    return String(a.rank).localeCompare(String(b.rank)) ||
      String(a.displayName).localeCompare(String(b.displayName));
  });

  const out = {
    ok:true,
    sheetName:model.sheetName || '',
    userCount:users.length,
    employeeNameMatched:users.filter(function(u){ return u.source === 'PERMISSION_EMPLOYEE_NAME'; }).length,
    fallbackCount:users.filter(function(u){ return u.source !== 'PERMISSION_EMPLOYEE_NAME'; }).length,
    users:users
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

function clearPermissionCache_(removePersistent) {
  const cache = CacheService.getScriptCache();
  const metaKey = CACHE_CFG.PERMISSION_MODEL_KEY + ':meta';
  let count = 0;
  try {
    const metaRaw = cache.get(metaKey);
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    count = meta && meta.chunks ? Number(meta.chunks) : 0;
  } catch (_) {}
  const keys = [metaKey];
  for (let i = 0; i < count; i++) keys.push(CACHE_CFG.PERMISSION_MODEL_KEY + ':chunk:' + i);
  try { cache.removeAll(keys); } catch (_) {}
  if (removePersistent === true) removePersistentJson_(RUNTIME_CFG.PERMISSION_PERSIST_KEY);
}


function putChunkedCacheJson_(baseKey, value, ttlSec) {
  const cache = CacheService.getScriptCache();
  const json = JSON.stringify(value);
  // Keep chunks comfortably below CacheService's per-value size limit,
  // including Vietnamese multi-byte characters.
  const chunkSize = 50000;
  const chunks = [];

  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.substring(i, i + chunkSize));
  }

  try {
    const payload = {};
    chunks.forEach(function(chunk, i) {
      payload[baseKey + ':chunk:' + i] = chunk;
    });
    payload[baseKey + ':meta'] = JSON.stringify({ chunks: chunks.length });
    cache.putAll(payload, ttlSec);
  } catch (_) {
    // Cache is an optimization only.
  }
}

function getChunkedCacheJson_(baseKey) {
  const cache = CacheService.getScriptCache();

  try {
    const metaRaw = cache.get(baseKey + ':meta');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const count = Number(meta.chunks || 0);
    if (!count) return null;

    const keys = [];
    for (let i = 0; i < count; i++) keys.push(baseKey + ':chunk:' + i);
    const found = cache.getAll(keys);
    let json = '';

    for (let i = 0; i < count; i++) {
      const part = found[baseKey + ':chunk:' + i];
      if (part == null) return null;
      json += part;
    }

    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}



function removeChunkedCacheJson_(baseKey) {
  const cache = CacheService.getScriptCache();
  let count = 0;
  try {
    const metaRaw = cache.get(baseKey + ':meta');
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    count = meta && meta.chunks ? Number(meta.chunks) : 0;
  } catch (_) {}

  const keys = [baseKey + ':meta'];
  for (let i = 0; i < count; i++) keys.push(baseKey + ':chunk:' + i);
  try { cache.removeAll(keys); } catch (_) {}
}


/* ============================================================
   MONTHLY KPI ENGINE — V7.3
   ------------------------------------------------------------
   Finds a sheet whose A1 header is "KPI Month" and whose row 1
   contains the KPI fields below. Station Name is matched to the
   Permission sheet's Hub Name.

   KPI fields:
   Grade
   Final Point
   %FM Ontime
   %LM Ontime
   %Deli Success
   %Sorter Productivity
   %Rider Productivity
   %Correct SOP - PU

   Multi-station summaries currently expose a simple station AVG
   for numeric metrics because only station-level percentages are
   available in this source. Replace this with official weighted /
   numerator-denominator aggregation when those raw components are
   supplied.
   ============================================================ */

const KPI_CFG = Object.freeze({
  TIMEZONE: 'Asia/Ho_Chi_Minh',

  // V0.17.8: KPI Result is discovered by SHEET NAME first, then Row 1.
  SHEET_NAMES: ['KPI Result'],

  MONTH_HEADERS: [
    'KPI Month',
    'Month',
    'Period'
  ],

  STATION_HEADERS: [
    'Station Name',
    'Hub Name',
    'Hub',
    'Profile Station'
  ],

  HUB_TYPE_HEADERS: [
    'Hub Type',
    'Type'
  ],

  // The monthly overview does not depend on physical column positions.
  // Every metric is resolved from Row 1 by exact normalized header aliases.
  METRICS: [
    {
      key:'grade',
      header:'Grade',
      aliases:['Grade'],
      label:'Grade',
      type:'text'
    },
    {
      key:'finalPoint',
      header:'Final Point',
      aliases:['Final Point','Final Point %','Final Score'],
      label:'Final Point',
      type:'percent'
    },
    {
      key:'fmOntime',
      header:'%FM Ontime',
      aliases:[
        '%FM Ontime',
        '% FM Ontime',
        '%FM On-time',
        'FM Ontime',
        'FM On-time'
      ],
      label:'%FM Ontime',
      type:'percent'
    },
    {
      key:'lmOntime',
      header:'%LM Ontime',
      aliases:[
        '%LM Ontime',
        '% LM Ontime',
        '%LM On-time',
        'LM Ontime',
        'LM On-time'
      ],
      label:'%LM Ontime',
      type:'percent'
    },
    {
      key:'deliSuccess',
      header:'%Deli Success',
      aliases:[
        '%Deli Success',
        '% Deli Success',
        '%Delivery Success',
        'Deli Success',
        'Delivery Success'
      ],
      label:'%Deli Success',
      type:'percent'
    },
    {
      key:'sorterProductivity',
      header:'%Sorter Productivity',
      aliases:[
        '%Sorter Productivity',
        '% Sorter Productivity',
        'Sorter Productivity',
        '%Sorter Prod',
        'Sorter Prod'
      ],
      label:'%Sorter Productivity',
      type:'percent'
    },
    {
      key:'riderProductivity',
      header:'%Rider Productivity',
      aliases:[
        '%Rider Productivity',
        '% Rider Productivity',
        'Rider Productivity',
        '%Rider Prod',
        'Rider Prod'
      ],
      label:'%Rider Productivity',
      type:'percent'
    },
    {
      key:'correctSopPu',
      header:'%Correct SOP - PU',
      aliases:[
        '%Correct SOP - PU',
        '%Correct SOP-PU',
        '%Correct SOP PU',
        'Correct SOP - PU',
        'Correct SOP-PU',
        'Correct SOP PU'
      ],
      label:'%Correct SOP - PU',
      type:'percent'
    }
  ],

  // Optional volume aliases. Missing volume must never be replaced with
  // equal weighting for multi-HUB Grade.
  VOLUME_HEADERS: [
    'Volume',
    'Total Volume',
    '#Volume',
    'KPI Volume',
    'Volume KPI',
    'Total Orders',
    '#Orders',
    'Orders',
    '#Deli Vol',
    '#Assigned Vol'
  ]
});

/* ============================================================
   MULTI-HUB GRADE RULE — SUP / LEAD MANAGING > 1 HUB
   ------------------------------------------------------------
   Grade -> point:
     A+ = 6
     A  = 5
     A- = 4
     B+ = 3
     B  = 2
     C  = 1

   Weighted score:
     SUM(GradePoint_i * HubVolume_i / TotalVolume)

   Final Grade cutoff (equivalent to ROUND to nearest point):
     score >= 5.50 -> A+
     score >= 4.50 -> A
     score >= 3.50 -> A-
     score >= 2.50 -> B+
     score >= 1.50 -> B
     otherwise     -> C

   IMPORTANT:
   - One HUB: use the HUB's source Grade directly.
   - Multi HUB: every matched HUB must have a valid Grade and Volume.
   - Missing Volume is NOT silently replaced with equal weight.
   ============================================================ */

const ORG_GRADE_CFG = Object.freeze({
  GRADE_TO_POINT: Object.freeze({
    'A+': 6,
    'A': 5,
    'A-': 4,
    'B+': 3,
    'B': 2,
    'C': 1
  }),
  CUTS: Object.freeze([
    { min:5.5, grade:'A+', point:6 },
    { min:4.5, grade:'A',  point:5 },
    { min:3.5, grade:'A-', point:4 },
    { min:2.5, grade:'B+', point:3 },
    { min:1.5, grade:'B',  point:2 },
    { min:-Infinity, grade:'C', point:1 }
  ])
});

function normalizeKpiHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeOrgGrade_(grade) {
  return String(grade || '').trim().toUpperCase();
}

function gradeToPoint_(grade) {
  const key = normalizeOrgGrade_(grade);
  const point = ORG_GRADE_CFG.GRADE_TO_POINT[key];
  return point == null ? null : point;
}

function weightedScoreToGrade_(score) {
  score = Number(score);
  if (!isFinite(score)) {
    return { score:null, roundedPoint:null, grade:null };
  }

  const cuts = ORG_GRADE_CFG.CUTS || [];
  const hit = cuts.find(function(rule) { return score >= rule.min; }) || null;
  return {
    score:score,
    roundedPoint:hit ? hit.point : null,
    grade:hit ? hit.grade : null
  };
}

function findHeaderIndexByAliases_(headers, aliases) {
  const normalized = (headers || []).map(normalizeKpiHeader_);
  const wanted = (aliases || []).map(normalizeKpiHeader_);

  for (let i = 0; i < wanted.length; i++) {
    const idx = normalized.indexOf(wanted[i]);
    if (idx !== -1) {
      return {
        index:idx,
        header:String(headers[idx] || '').trim(),
        alias:String((aliases || [])[i] || '')
      };
    }
  }

  return { index:-1, header:'', alias:'' };
}

function findKpiVolumeColumn_(headers) {
  return findHeaderIndexByAliases_(
    headers,
    KPI_CFG.VOLUME_HEADERS || []
  );
}

function detectKpiResultColumns_(headers) {
  const month = findHeaderIndexByAliases_(
    headers,
    KPI_CFG.MONTH_HEADERS || ['KPI Month']
  );

  const station = findHeaderIndexByAliases_(
    headers,
    KPI_CFG.STATION_HEADERS || ['Station Name']
  );

  const hubType = findHeaderIndexByAliases_(
    headers,
    KPI_CFG.HUB_TYPE_HEADERS || ['Hub Type']
  );

  const volume = findKpiVolumeColumn_(headers);
  const metrics = {};
  const missingMetrics = [];

  KPI_CFG.METRICS.forEach(function(metric) {
    const hit = findHeaderIndexByAliases_(
      headers,
      metric.aliases || [metric.header]
    );

    metrics[metric.key] = hit;

    if (hit.index < 0 &&
        metric.key !== 'grade' &&
        metric.key !== 'finalPoint') {
      missingMetrics.push(metric.label);
    }
  });

  return {
    month:month,
    station:station,
    hubType:hubType,
    volume:volume,
    metrics:metrics,
    missingMetrics:missingMetrics
  };
}

function isUsableKpiResultHeader_(headers) {
  const columns = detectKpiResultColumns_(headers);

  if (columns.month.index < 0 ||
      columns.station.index < 0) {
    return false;
  }

  // At least one of the six primary KPI columns must exist.
  const primaryKeys = [
    'fmOntime',
    'lmOntime',
    'deliSuccess',
    'sorterProductivity',
    'riderProductivity',
    'correctSopPu'
  ];

  return primaryKeys.some(function(key) {
    return columns.metrics[key] &&
      columns.metrics[key].index >= 0;
  });
}

function findKpiSheet_(ss) {
  // Priority 1: exact configured sheet name.
  const preferredNames = KPI_CFG.SHEET_NAMES || ['KPI Result'];

  for (let i = 0; i < preferredNames.length; i++) {
    const sh = ss.getSheetByName(preferredNames[i]);
    if (!sh || sh.getLastColumn() < 2) continue;

    const headers = sh
      .getRange(1, 1, 1, sh.getLastColumn())
      .getDisplayValues()[0]
      .map(function(v) {
        return String(v || '').trim();
      });

    if (isUsableKpiResultHeader_(headers)) {
      return sh;
    }
  }

  // Fallback: scan sheets only by Row-1 structure.
  const sheets = ss.getSheets();

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const lastCol = sh.getLastColumn();
    if (lastCol < 2) continue;

    const headers = sh
      .getRange(1, 1, 1, lastCol)
      .getDisplayValues()[0]
      .map(function(v) {
        return String(v || '').trim();
      });

    if (isUsableKpiResultHeader_(headers)) {
      return sh;
    }
  }

  return null;
}


function getKpiModel_(forceRefresh) {
  if (forceRefresh === true) {
    removeChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY);
    removePersistentJson_(RUNTIME_CFG.KPI_MODEL_PERSIST_KEY);
  }
  const cached = getChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY);
  if (cached) return cached;

  const persisted = getPersistentJson_(RUNTIME_CFG.KPI_MODEL_PERSIST_KEY);
  if (persisted && forceRefresh !== true) {
    putChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY, persisted, CACHE_CFG.KPI_TTL_SEC);
    return persisted;
  }

  const built = buildKpiModel_();
  putChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY, built, CACHE_CFG.KPI_TTL_SEC);
  putPersistentJson_(RUNTIME_CFG.KPI_MODEL_PERSIST_KEY, built);
  return built;
}


function buildKpiModel_() {
  const ss = getDb_();
  const sheet = findKpiSheet_(ss);

  if (!sheet) {
    return {
      sheetFound:false,
      sheetName:'',
      generatedAt:new Date().toISOString(),
      months:[],
      rows:[],
      volumeHeader:'',
      detectedColumns:{},
      missingMetrics:KPI_CFG.METRICS
        .filter(function(m) {
          return m.key !== 'grade' &&
            m.key !== 'finalPoint';
        })
        .map(function(m) {
          return m.label;
        })
    };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  const headers = sheet
    .getRange(1, 1, 1, lastCol)
    .getDisplayValues()[0]
    .map(function(v) {
      return String(v || '').trim();
    });

  const columns = detectKpiResultColumns_(headers);

  if (columns.month.index < 0 ||
      columns.station.index < 0) {
    return {
      sheetFound:true,
      sheetName:sheet.getName(),
      generatedAt:new Date().toISOString(),
      months:[],
      rows:[],
      volumeHeader:columns.volume.header || '',
      detectedColumns:columns,
      missingMetrics:columns.missingMetrics || [],
      error:'KPI_RESULT_REQUIRED_HEADER_MISSING'
    };
  }

  if (lastRow < 2) {
    return {
      sheetFound:true,
      sheetName:sheet.getName(),
      generatedAt:new Date().toISOString(),
      months:[],
      rows:[],
      volumeHeader:columns.volume.header || '',
      detectedColumns:columns,
      missingMetrics:columns.missingMetrics || []
    };
  }

  // IMPORTANT:
  // getValues() = true typed values.
  // getDisplayValues() = formatted fallback.
  // Do NOT use display strings as raw values.
  const range = sheet.getRange(
    2,
    1,
    lastRow - 1,
    lastCol
  );

  const raw = range.getValues();
  const disp = range.getDisplayValues();

  const rows = [];
  const months = {};

  raw.forEach(function(r, idx) {
    const d = disp[idx];

    const monthKey = kpiMonthKey_(
      r[columns.month.index],
      d[columns.month.index]
    );

    const stationName = String(
      d[columns.station.index] ||
      r[columns.station.index] ||
      ''
    ).trim();

    if (!monthKey || !stationName) return;

    months[monthKey] = true;

    const item = {
      rowNumber:idx + 2,
      monthKey:monthKey,
      stationName:stationName,
      stationKey:normalizeStationName_(stationName),
      hubType:columns.hubType.index >= 0
        ? String(
            d[columns.hubType.index] ||
            r[columns.hubType.index] ||
            ''
          ).trim()
        : '',
      volume:columns.volume.index >= 0
        ? kpiCountCell_(
            r[columns.volume.index],
            d[columns.volume.index]
          )
        : {
            display:'',
            numeric:null,
            error:false
          },
      reporting:(function(){
        const meta={};
        ['As Of','Method','Status','Notes','Expected Days','FM Days','LM Days','DSR Days','Sorter Days','Rider Days','SOP Days'].forEach(function(name){const i=headers.indexOf(name);if(i>=0)meta[name]=r[i]==null?'':r[i]});
        return meta;
      })(),
      values:{}
    };

    KPI_CFG.METRICS.forEach(function(metric) {
      const hit = columns.metrics[metric.key];

      if (!hit || hit.index < 0) {
        item.values[metric.key] = {
          display:'',
          numeric:null,
          error:false
        };
        return;
      }

      item.values[metric.key] = kpiMetricCell_(
        r[hit.index],
        d[hit.index],
        metric.type
      );
    });

    rows.push(item);
  });

  const detectedColumns = {
    month:columns.month,
    station:columns.station,
    hubType:columns.hubType,
    volume:columns.volume,
    metrics:{}
  };

  Object.keys(columns.metrics || {}).forEach(function(key) {
    detectedColumns.metrics[key] = columns.metrics[key];
  });

  return {
    sheetFound:true,
    sheetName:sheet.getName(),
    generatedAt:new Date().toISOString(),
    months:Object.keys(months).sort().reverse(),
    volumeHeader:columns.volume.header || '',
    detectedColumns:detectedColumns,
    missingMetrics:columns.missingMetrics || [],
    rows:rows
  };
}



function sourceDateKey_(value) {
  const tz = 'Asia/Ho_Chi_Minh';

  if (
    Object.prototype.toString.call(value) === '[object Date]' &&
    !isNaN(value.getTime())
  ) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }

  const text = String(value == null ? '' : value).trim();
  if (!text) return '';

  let m = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  // Current source sheets display month/day/year.
  // 9/1/2026 = 01-Sep-2026; 9/8/2026 = 08-Sep-2026.
  m = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return String(year) + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
    }
  }

  return '';
}


function kpiMonthKey_(rawValue, displayValue) {
  const tz = KPI_CFG.TIMEZONE;

  if (
    Object.prototype.toString.call(rawValue) === '[object Date]' &&
    !isNaN(rawValue.getTime())
  ) {
    return Utilities.formatDate(rawValue, tz, 'yyyy-MM');
  }

  const rawKey = sourceDateKey_(rawValue);
  if (rawKey) return rawKey.slice(0, 7);

  const displayKey = sourceDateKey_(displayValue);
  if (displayKey) return displayKey.slice(0, 7);

  const text = String(displayValue || rawValue || '').trim();
  const m = text.match(/^(\d{4})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);

  return '';
}

function kpiMetricCell_(rawValue, displayValue, type) {
  const display = String(displayValue == null ? '' : displayValue).trim();
  if (type === 'text') {
    return { display:display || String(rawValue || '').trim(), numeric:null, error:false };
  }
  let numeric = null;
  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    numeric = rawValue;
    // Google Sheets percentages are usually stored as decimals.
    if (Math.abs(numeric) <= 5) numeric = numeric * 100;
  } else {
    const cleaned = display.replace(/,/g, '').replace(/%/g, '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) numeric = Number(cleaned);
  }
  return {
    display:display,
    numeric:(numeric != null && isFinite(numeric)) ? numeric : null,
    error:!!display && numeric == null
  };
}

function kpiCountCell_(rawValue, displayValue) {
  const display = String(displayValue == null ? '' : displayValue).trim();
  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    return { display:display || String(rawValue), numeric:rawValue, error:false };
  }
  if (!display) return { display:'', numeric:null, error:false };

  // Volume is a count. Remove common thousand separators safely.
  let text = display.replace(/\s/g, '').replace(/,/g, '');
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    return { display:display, numeric:isFinite(n) ? n : null, error:!isFinite(n) };
  }
  return { display:display, numeric:null, error:true };
}

function normalizeStationName_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function debugKpiResultHeaderMapping() {
  requireAdmin_();

  const ss = getDb_();
  const sheet = findKpiSheet_(ss);

  if (!sheet) {
    const missing = {
      ok:false,
      sheetFound:false,
      expectedSheetNames:KPI_CFG.SHEET_NAMES,
      primaryMetrics:KPI_CFG.METRICS
        .filter(function(m) {
          return [
            'fmOntime',
            'lmOntime',
            'deliSuccess',
            'sorterProductivity',
            'riderProductivity',
            'correctSopPu'
          ].indexOf(m.key) !== -1;
        })
        .map(function(m) {
          return m.label;
        })
    };

    console.log(JSON.stringify(missing, null, 2));
    return missing;
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(function(v) {
      return String(v || '').trim();
    });

  const columns = detectKpiResultColumns_(headers);

  const out = {
    ok:true,
    sheetName:sheet.getName(),
    lastRow:sheet.getLastRow(),
    lastColumn:sheet.getLastColumn(),
    columns:columns,
    row1:headers
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

function refreshKpiResultDynamicMappingV178() {
  requireAdmin_();

  removeChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY);
  removePersistentJson_(RUNTIME_CFG.KPI_MODEL_PERSIST_KEY);

  const model = getKpiModel_(true);

  try {
    if (typeof clearFastBootSnapshot_ === 'function') {
      clearFastBootSnapshot_();
    }
  } catch (_) {}

  const out = {
    ok:model.sheetFound !== false,
    sheetName:model.sheetName || '',
    rows:(model.rows || []).length,
    months:model.months || [],
    detectedColumns:model.detectedColumns || {},
    missingMetrics:model.missingMetrics || [],
    generatedAt:model.generatedAt || ''
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

function getKpiBootstrap_() {
  const model = getKpiModel_(false);
  const tz = KPI_CFG.TIMEZONE;
  const currentMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const defaultMonth = model.months.indexOf(currentMonth) !== -1
    ? currentMonth
    : (model.months[0] || currentMonth);

  return {
    sheetFound:model.sheetFound !== false,
    sheetName:model.sheetName || '',
    volumeHeader:model.volumeHeader || '',
    detectedColumns:model.detectedColumns || {},
    missingMetrics:model.missingMetrics || [],
    months:(model.months || []).map(function(key) {
      return { value:key, label:kpiMonthLabel_(key) };
    }),
    currentMonth:currentMonth,
    defaultMonth:defaultMonth,
    metrics:KPI_CFG.METRICS.map(function(m) {
      return { key:m.key, label:m.label, type:m.type };
    })
  };
}

function kpiMonthLabel_(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 2) return key;
  return parts[1] + '/' + parts[0];
}

function calculateMultiHubGrade_(rows) {
  rows = Array.isArray(rows) ? rows : [];
  if (!rows.length) {
    return {
      ok:false,
      mode:'WEIGHTED_VOLUME',
      grade:null,
      weightedScore:null,
      roundedPoint:null,
      totalVolume:0,
      hubCount:0,
      validHubCount:0,
      invalidHubs:[],
      rows:[],
      reason:'NO_HUB_ROWS'
    };
  }

  const details = rows.map(function(row) {
    const grade = normalizeOrgGrade_(row.grade);
    const gradePoint = gradeToPoint_(grade);
    const volume = row.volume && typeof row.volume.numeric === 'number'
      ? row.volume.numeric
      : null;
    const validGrade = gradePoint != null;
    const validVolume = volume != null && isFinite(volume) && volume >= 0;

    return {
      hubCode:String(row.hubCode || ''),
      hubName:String(row.stationName || row.hubName || ''),
      grade:grade,
      gradePoint:gradePoint,
      volume:validVolume ? volume : null,
      validGrade:validGrade,
      validVolume:validVolume,
      valid:validGrade && validVolume
    };
  });

  const invalidHubs = details.filter(function(x) { return !x.valid; });
  if (invalidHubs.length) {
    return {
      ok:false,
      mode:'WEIGHTED_VOLUME',
      grade:null,
      weightedScore:null,
      roundedPoint:null,
      totalVolume:null,
      hubCount:details.length,
      validHubCount:details.length - invalidHubs.length,
      invalidHubs:invalidHubs.map(function(x) {
        return {
          hubCode:x.hubCode,
          hubName:x.hubName,
          grade:x.grade,
          hasValidGrade:x.validGrade,
          hasValidVolume:x.validVolume
        };
      }),
      rows:details,
      reason:'INCOMPLETE_GRADE_OR_VOLUME'
    };
  }

  const totalVolume = details.reduce(function(sum, x) { return sum + Number(x.volume || 0); }, 0);
  if (!(totalVolume > 0)) {
    return {
      ok:false,
      mode:'WEIGHTED_VOLUME',
      grade:null,
      weightedScore:null,
      roundedPoint:null,
      totalVolume:totalVolume,
      hubCount:details.length,
      validHubCount:details.length,
      invalidHubs:[],
      rows:details,
      reason:'TOTAL_VOLUME_ZERO'
    };
  }

  details.forEach(function(x) {
    x.volumeWeight = x.volume / totalVolume;
    x.volumeWeightPct = x.volumeWeight * 100;
    x.weightedPoint = x.gradePoint * x.volumeWeight;
  });

  const weightedScore = details.reduce(function(sum, x) {
    return sum + Number(x.weightedPoint || 0);
  }, 0);

  const final = weightedScoreToGrade_(weightedScore);
  return {
    ok:true,
    mode:'WEIGHTED_VOLUME',
    grade:final.grade,
    weightedScore:weightedScore,
    weightedScoreDisplay:weightedScore.toFixed(2),
    roundedPoint:final.roundedPoint,
    totalVolume:totalVolume,
    hubCount:details.length,
    validHubCount:details.length,
    invalidHubs:[],
    rows:details,
    reason:''
  };
}

function resolveSelectedAuthorizedHubCodes_(resolvedView, selectedHubCodes) {
  const allowed = (resolvedView && resolvedView.hubCodes ? resolvedView.hubCodes : []).slice();
  const requested = Array.isArray(selectedHubCodes) ? selectedHubCodes : [];
  if (!requested.length) return allowed;

  const allowedSet = makeHubSet_(allowed);
  const seen = {};
  return requested
    .map(function(code) { return String(code || '').trim(); })
    .filter(function(code) {
      const key = normalizeCompare_(code);
      if (!key || seen[key] || !allowedSet[key]) return false;
      seen[key] = true;
      return true;
    });
}


/* ============================================================
   CLIENT MASTER CACHE API — V0.17.18
   ============================================================ */

function fullAuthorizedHubCodes_(access, permission) {
  if (access && access.isAdmin) {
    return (permission.stations || [])
      .map(function(s) { return String(s.hubCode || '').trim(); })
      .filter(Boolean);
  }
  return (access && access.hubCodes ? access.hubCodes : []).slice();
}

function buildPermissionStationAliasIndex_(permission, allowedSet) {
  const exact = {};
  const canonical = {};
  const collisions = {};

  function add(alias, station) {
    alias = String(alias || '').trim();
    if (!alias || !station) return;
    const codeKey = normalizeCompare_(station.hubCode);
    if (allowedSet && !allowedSet[codeKey]) return;

    const e = normalizeStationName_(alias);
    if (e && !exact[e]) exact[e] = station;

    const c = forecastCanonicalHubKey_(alias);
    if (!c) return;
    if (canonical[c] && normalizeCompare_(canonical[c].hubCode) !== codeKey) {
      collisions[c] = true;
      delete canonical[c];
    } else if (!collisions[c]) {
      canonical[c] = station;
    }
  }

  (permission.stations || []).forEach(function(station) {
    add(station.hubName, station);
    add(station.hubCode, station);
  });

  return {
    resolve:function(name) {
      const e = normalizeStationName_(name);
      if (exact[e]) return exact[e];
      const c = forecastCanonicalHubKey_(name);
      return canonical[c] || null;
    }
  };
}

function monthlyKpiReleaseStatus_(month, todayKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return {gradeReleased:false,gradeReleaseDate:''};
  let year = Number(match[1]), nextMonth = Number(match[2]) + 1;
  if (nextMonth > 12) { year += 1; nextMonth = 1; }
  const releaseDate = year + '-' + String(nextMonth).padStart(2, '0') + '-22';
  const today = todayKey || Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  return {gradeReleased:today >= releaseDate,gradeReleaseDate:releaseDate,reportDate:today};
}

function getKpiClientMonthCacheUncached_(monthKey, forceRefresh) {
  const access = requireAccess_(['dashboard', 'kpi']);
  const permission = getPermissionModel_(false);
  const effectiveForce = allowHeavyForceRefresh_(access, 'monthly-kpi-client-cache', forceRefresh === true);
  const model = getKpiModel_(effectiveForce);

  const currentMonth = Utilities.formatDate(new Date(), KPI_CFG.TIMEZONE, 'yyyy-MM');
  const defaultMonth = (model.months || []).indexOf(currentMonth) !== -1
    ? currentMonth
    : ((model.months || [])[0] || currentMonth);
  const selectedMonth = String(monthKey || defaultMonth || '').trim();
  const release = monthlyKpiReleaseStatus_(selectedMonth);

  const hubCodes = fullAuthorizedHubCodes_(access, permission);
  const allowed = {};
  hubCodes.forEach(function(code) { allowed[normalizeCompare_(code)] = true; });
  const matcher = buildPermissionStationAliasIndex_(permission, allowed);
  const matched = {};

  (model.rows || []).forEach(function(row) {
    if (row.monthKey !== selectedMonth) return;
    const station = matcher.resolve(row.stationName);
    if (!station) return;
    matched[normalizeCompare_(station.hubCode)] = {
      rowNumber:row.rowNumber,
      month:row.monthKey,
      hubCode:station.hubCode,
      stationName:station.hubName || row.stationName,
      hubType:row.hubType || station.type || '',
      grade:release.gradeReleased ? row.values.grade.display : '',
      volume:row.volume || { display:'', numeric:null, error:false },
      finalPoint:row.values.finalPoint,
      fmOntime:row.values.fmOntime,
      lmOntime:row.values.lmOntime,
      deliSuccess:row.values.deliSuccess,
      sorterProductivity:row.values.sorterProductivity,
      riderProductivity:row.values.riderProductivity,
      correctSopPu:row.values.correctSopPu,
      reporting:row.reporting||{}
    };
  });

  function blankCell() { return { display:'—', numeric:null, error:false }; }

  const rows = hubCodes.map(function(code) {
    const key = normalizeCompare_(code);
    if (matched[key]) return matched[key];
    const station = stationByHubCode_(permission, code) || { hubCode:code, hubName:code, type:'' };
    return {
      rowNumber:0,
      month:selectedMonth,
      hubCode:station.hubCode || code,
      stationName:station.hubName || code,
      hubType:station.type || '',
      grade:'',
      volume:blankCell(),
      finalPoint:blankCell(),
      fmOntime:blankCell(),
      lmOntime:blankCell(),
      deliSuccess:blankCell(),
      sorterProductivity:blankCell(),
      riderProductivity:blankCell(),
      correctSopPu:blankCell(),
      missingKpi:true
    };
  }).sort(function(a,b){ return String(a.stationName || '').localeCompare(String(b.stationName || '')); });

  return {
    ok:true,
    sheetFound:model.sheetFound !== false,
    sheetName:model.sheetName || '',
    month:selectedMonth,
    gradeReleased:release.gradeReleased,
    gradeReleaseDate:release.gradeReleaseDate,
    reportDate:release.reportDate,
    monthLabel:kpiMonthLabel_(selectedMonth),
    volumeHeader:model.volumeHeader || '',
    availableMonths:(model.months || []).map(function(key){ return { value:key, label:kpiMonthLabel_(key) }; }),
    rows:rows,
    authorizedHubCodes:hubCodes,
    generatedAt:model.generatedAt || '',
    serverTime:new Date().toISOString()
  };
}

function getDailyKpiClientPeriodCacheUncached_(period, forceRefresh) {
  const access = requireAccess_(['kpi']);
  const permission = getPermissionModel_(false);

  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  const hubCodes =
    fullAuthorizedHubCodes_(
      access,
      permission
    );

  const allowed = {};

  hubCodes.forEach(function(code) {
    allowed[
      normalizeCompare_(code)
    ] = true;
  });

  const model =
    getKpiDailyDirectModel_(
      forceRefresh === true
    );

  // Grade rules are used ONLY to display the aggregate/average daily grade.
  // Individual HUB Grade / Final Point / KPI values still come directly
  // from KPI Daily and are never re-scored here.
  const config =
    resolveKpiConfig_(
      period,
      false
    );

  const gradeRules =
    (config.grades || [])
      .map(function(r) {
        return {
          grade:
            String(
              r.grade || ''
            ).trim(),

          minPointPct:
            r.minPointPct == null
              ? null
              : Number(r.minPointPct),

          maxPointPct:
            r.maxPointPct == null
              ? null
              : Number(r.maxPointPct)
        };
      })
      .filter(function(r) {
        return (
          r.grade &&
          r.minPointPct != null &&
          isFinite(r.minPointPct)
        );
      })
      .sort(function(a, b) {
        return (
          Number(b.minPointPct || 0) -
          Number(a.minPointPct || 0)
        );
      });

  if (
    !model ||
    model.sheetFound === false
  ) {
    return {
      ok:true,
      dataReady:false,

      period:period,
      periodLabel:
        dailyKpiPeriodLabel_(period),

      periods:[],
      defaultPeriod:period,

      rows:[],
      authorizedHubCodes:
        hubCodes,

      gradeRules:
        gradeRules,

      averageMethod:
        'ARITHMETIC_MEAN_NONBLANK',

      generatedAt:'',

      sourceMeta:
        model
          ? model.sourceMeta || {}
          : {},

      serverTime:
        new Date().toISOString()
    };
  }

  /*
   * Compact browser payload:
   *
   *  0 dateKey
   *  1 hubCode
   *  2 hubName
   *  3 hubType
   *  4 region
   *  5 source Grade
   *  6 source Final Point %
   *  7 source FM %
   *  8 source LM %
   *  9 source Deli Success %
   * 10 source Sorter Productivity %
   * 11 source Rider Productivity %
   * 12 source Correct SOP - PU %
   * 13 source row exists
   *
   * No calculation is performed on individual HUB rows.
   */
  const rows = [];

  (model.rows || [])
    .forEach(function(row) {
      if (
        row[0] !== period
      ) {
        return;
      }

      if (
        !allowed[
          normalizeCompare_(row[2])
        ]
      ) {
        return;
      }

      rows.push([
        row[1],
        row[2],
        row[3],
        row[4] || '',
        row[5] || '',
        row[6] || '',
        row[7],
        row[8],
        row[9],
        row[10],
        row[11],
        row[12],
        row[13],
        row[15] === true
      ]);
    });

  const current =
    dailyKpiCurrentPeriod_();

  const defaultPeriod =
    (model.periods || [])
      .indexOf(current) !== -1
        ? current
        : (
            (model.periods || [])[0] ||
            period
          );

  return {
    ok:true,
    dataReady:true,

    period:period,
    periodLabel:
      dailyKpiPeriodLabel_(period),

    periods:
      (model.periods || [])
        .map(function(p) {
          return {
            value:p,
            label:
              dailyKpiPeriodLabel_(p)
          };
        }),

    defaultPeriod:
      defaultPeriod,

    rows:rows,

    authorizedHubCodes:
      hubCodes,

    gradeRules:
      gradeRules,

    // Daily aggregate values shown in the main table are arithmetic
    // averages of available numeric source values for the selected HUBs.
    averageMethod:
      'ARITHMETIC_MEAN_NONBLANK',

    generatedAt:
      model.generatedAt || '',

    sourceMeta:
      model.sourceMeta || {},

    cacheHit:
      Boolean(model.cacheHit),

    serverTime:
      new Date().toISOString()
  };
}


function getKpiDashboard(path, monthKey, selectedHubCodes, forceRefresh) {
  // Backward compatibility with V0.8.x calls: third argument used to be forceRefresh.
  if (typeof selectedHubCodes === 'boolean') {
    forceRefresh = selectedHubCodes;
    selectedHubCodes = [];
  }

  const access = requireAccess_(['dashboard', 'kpi']);
  const effectiveForce = allowHeavyForceRefresh_(access, 'monthly-kpi', forceRefresh === true);
  const resolved = assertDrillPathAccess_(access, path || {});
  const model = getKpiModel_(effectiveForce);
  const currentMonth = Utilities.formatDate(new Date(), KPI_CFG.TIMEZONE, 'yyyy-MM');
  const defaultMonth = (model.months || []).indexOf(currentMonth) !== -1 ? currentMonth : ((model.months || [])[0] || currentMonth);
  const selectedMonth = String(monthKey || defaultMonth || '').trim();
  const hubCodes = resolveSelectedAuthorizedHubCodes_(resolved.view, selectedHubCodes);

  if (!model.sheetFound) {
    return {
      ok:true,
      sheetFound:false,
      month:selectedMonth,
      rows:[],
      summary:{},
      gradeRollup:null,
      volumeHeader:'',
      matchedStations:0,
      scopeStations:hubCodes.length,
      selectedHubCodes:hubCodes
    };
  }

  const permission = getPermissionModel_(false);
  const stationNames = {};
  hubCodes.forEach(function(code) {
    const station = extendedStationByHubCode_(permission, code);
    if (station) stationNames[normalizeStationName_(station.hubName)] = station;
  });

  const matchedByHub = {};

  (model.rows || [])
    .filter(function(r) {
      return r.monthKey === selectedMonth && stationNames[r.stationKey];
    })
    .forEach(function(r) {
      const station = stationNames[r.stationKey];
      if (!station) return;

      matchedByHub[normalizeCompare_(station.hubCode)] = {
        rowNumber:r.rowNumber,
        month:r.monthKey,
        hubCode:station.hubCode,
        stationName:station.hubName || r.stationName,
        hubType:r.hubType || station.type || '',
        grade:r.values.grade.display,
        volume:r.volume || { display:'', numeric:null, error:false },
        finalPoint:r.values.finalPoint,
        fmOntime:r.values.fmOntime,
        lmOntime:r.values.lmOntime,
        deliSuccess:r.values.deliSuccess,
        sorterProductivity:r.values.sorterProductivity,
        riderProductivity:r.values.riderProductivity,
        correctSopPu:r.values.correctSopPu
      };
    });

  function blankKpiCell_() {
    return { display:'—', numeric:null, error:false };
  }

  // Every HUB in the selected/authorized scope is rendered. Missing KPI data
  // is represented by "—"; Grade is blank and is never fabricated.
  const rows = hubCodes.map(function(code) {
    const key = normalizeCompare_(code);
    if (matchedByHub[key]) return matchedByHub[key];

    const station = extendedStationByHubCode_(permission, code) || {
      hubCode:code,
      hubName:code
    };

    return {
      rowNumber:0,
      month:selectedMonth,
      hubCode:station.hubCode || code,
      stationName:station.hubName || code,
      hubType:station.type || '',
      grade:'',
      volume:blankKpiCell_(),
      finalPoint:blankKpiCell_(),
      fmOntime:blankKpiCell_(),
      lmOntime:blankKpiCell_(),
      deliSuccess:blankKpiCell_(),
      sorterProductivity:blankKpiCell_(),
      riderProductivity:blankKpiCell_(),
      correctSopPu:blankKpiCell_(),
      missingKpi:true
    };
  }).sort(function(a,b) {
    return String(a.stationName || '').localeCompare(String(b.stationName || ''));
  });

  const gradeRollup = rows.length > 1
    ? calculateMultiHubGrade_(rows)
    : (rows.length === 1
        ? {
            ok:true,
            mode:'DIRECT_HUB',
            grade:normalizeOrgGrade_(rows[0].grade) || null,
            weightedScore:gradeToPoint_(rows[0].grade),
            weightedScoreDisplay:gradeToPoint_(rows[0].grade) == null ? '' : Number(gradeToPoint_(rows[0].grade)).toFixed(2),
            roundedPoint:gradeToPoint_(rows[0].grade),
            totalVolume:rows[0].volume && rows[0].volume.numeric != null ? rows[0].volume.numeric : null,
            hubCount:1,
            validHubCount:1,
            invalidHubs:[],
            rows:[],
            reason:''
          }
        : null);

  return {
    ok:true,
    sheetFound:true,
    sheetName:model.sheetName,
    volumeHeader:model.volumeHeader || '',
    month:selectedMonth,
    monthLabel:kpiMonthLabel_(selectedMonth),
    path:resolved.path,
    view:resolved.view,
    selectedHubCodes:hubCodes,
    scopeStations:hubCodes.length,
    matchedStations:Object.keys(matchedByHub).length,
    missingStations:Math.max(0, hubCodes.length - Object.keys(matchedByHub).length),
    summary:buildKpiSummary_(rows, gradeRollup),
    gradeRollup:gradeRollup,
    rows:rows,
    aggregationNote:buildKpiAggregationNote_(rows, gradeRollup, model.volumeHeader || ''),
    availableMonths:(model.months || []).map(function(key){ return { value:key, label:kpiMonthLabel_(key) }; }),
    serverTime:new Date().toISOString()
  };
}

function buildKpiSummary_(rows, gradeRollup) {
  const out = {};
  KPI_CFG.METRICS.forEach(function(metric) {
    if (metric.type === 'text') {
      if (metric.key === 'grade') {
        out.grade = {
          label:metric.label,
          display:gradeRollup && gradeRollup.ok && gradeRollup.grade ? gradeRollup.grade : (rows.length === 1 ? (rows[0].grade || '—') : '—'),
          numeric:gradeRollup && gradeRollup.ok ? gradeRollup.weightedScore : null,
          validCount:gradeRollup ? Number(gradeRollup.validHubCount || 0) : 0,
          mode:gradeRollup ? gradeRollup.mode : '',
          weightedScore:gradeRollup && gradeRollup.ok ? gradeRollup.weightedScore : null,
          roundedPoint:gradeRollup && gradeRollup.ok ? gradeRollup.roundedPoint : null,
          totalVolume:gradeRollup && gradeRollup.ok ? gradeRollup.totalVolume : null,
          reason:gradeRollup && !gradeRollup.ok ? gradeRollup.reason : ''
        };
      } else {
        out[metric.key] = {
          label:metric.label,
          display:rows.length === 1 ? (rows[0][metric.key] || '') : '—',
          numeric:null,
          validCount:rows.length === 1 ? 1 : 0
        };
      }
      return;
    }

    const vals = rows
      .map(function(r) { return r[metric.key] && r[metric.key].numeric; })
      .filter(function(v) { return typeof v === 'number' && isFinite(v); });
    const avg = vals.length ? vals.reduce(function(a,b) { return a+b; }, 0) / vals.length : null;
    out[metric.key] = {
      label:metric.label,
      display:avg == null ? '—' : avg.toFixed(2) + '%',
      numeric:avg,
      validCount:vals.length
    };
  });
  return out;
}

function buildKpiAggregationNote_(rows, gradeRollup, volumeHeader) {
  if (!rows || rows.length <= 1) return '';

  if (gradeRollup && gradeRollup.ok) {
    return 'Grade uses official multi-HUB rule: Hub Grade → point (A+=6, A=5, A-=4, B+=3, B=2, C=1) × HUB volume weight → weighted score → final Grade. Volume source: ' + (volumeHeader || 'Volume') + '. Other numeric KPI cards are still simple station averages until official numerator/denominator aggregation is supplied.';
  }

  if (!volumeHeader) {
    return 'Multi-HUB Grade cannot be calculated because no Volume column was detected in the KPI Month source. Add one of: ' + KPI_CFG.VOLUME_HEADERS.join(', ') + '. Equal weighting is intentionally NOT used.';
  }

  if (gradeRollup && gradeRollup.reason === 'INCOMPLETE_GRADE_OR_VOLUME') {
    return 'Multi-HUB Grade is waiting for complete Grade + Volume data for every matched HUB. Volume source: ' + volumeHeader + '. Equal weighting is intentionally NOT used.';
  }

  return 'Multi-HUB Grade could not be calculated for the current scope. Check HUB Grade and Volume data.';
}

function refreshKpiCache() {
  requireAdmin_();
  removeChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY);
  const model = getKpiModel_(true);
  return {
    ok:true,
    sheetName:model.sheetName || '',
    volumeHeader:model.volumeHeader || '',
    months:model.months || [],
    rowCount:(model.rows || []).length
  };
}


/* ============================================================
   HISTORICAL FORECAST ANALYTICS ENGINE — V9.0
   ------------------------------------------------------------
   Source sheet: Historical Forecast

   Expected fields:
   Date, Region, Province, Hub Name,
   #FM Forecast, #FM Inbound, %FM Difference, #Pickup Done,
   #LM Forecast, #LM Inbound, %LM Difference,
   #LM LH Arrived, #LM SOC Transported

   SECURITY:
   Every request is resolved through assertDrillPathAccess_().
   The browser never decides which hubs are allowed.

   AGGREGATION:
   Count fields are SUMMED.
   %FM Difference and %LM Difference are RECALCULATED from
   aggregated counts:
     (Inbound - Forecast) / Forecast
   They are never averaged across hubs.

   NOTE:
   "% Difference" remains a source monitoring metric. It is not
   treated as the final business KPI "Forecast Accuracy".
   ============================================================ */

const FORECAST_CFG = Object.freeze({
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  SHEET_NAME: 'Historical Forecast',
  SHEET_ALIASES: ['Historical Forecast', 'Forecast D-1', 'Forecast D1', 'Forecast'],
  MAX_TREND_DAYS: 31,

  // Canonical field names used internally. Header aliases make the reader
  // tolerant of leading #/% signs, spacing, hidden characters and minor
  // naming differences without changing the business meaning of each field.
  HEADER_ALIASES: {
    date: ['date'],
    region: ['region'],
    province: ['province'],
    hubName: ['hub name', 'station name'],
    fmForecast: ['#fm forecast', 'fm forecast'],
    fmInbound: ['#fm inbound', 'fm inbound'],
    fmDifference: ['%fm difference', 'fm difference', '% fm difference'],
    pickupDone: ['#pickup done', 'pickup done'],
    lmForecast: ['#lm forecast', 'lm forecast'],
    lmInbound: ['#lm inbound', 'lm inbound'],
    lmDifference: ['%lm difference', 'lm difference', '% lm difference'],
    lmLhArrived: ['#lm lh arrived', 'lm lh arrived'],
    lmSocTransported: ['#lm soc transported', 'lm soc transported']
  },

  REQUIRED_FIELDS: [
    'date',
    'region',
    'province',
    'hubName',
    'fmForecast',
    'fmInbound',
    'fmDifference',
    'pickupDone',
    'lmForecast',
    'lmInbound',
    'lmDifference',
    'lmLhArrived',
    'lmSocTransported'
  ]
});

function normalizeForecastHeader_(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findForecastSheet_(ss) {
  const aliases = (FORECAST_CFG.SHEET_ALIASES || [FORECAST_CFG.SHEET_NAME])
    .map(normalizeCompare_);

  const exact = ss.getSheetByName(FORECAST_CFG.SHEET_NAME);
  if (exact) return exact;

  return ss.getSheets().find(function(sh) {
    return aliases.indexOf(normalizeCompare_(sh.getName())) !== -1;
  }) || null;
}

function forecastHeaderMatches_(header, aliases) {
  const normalized = normalizeForecastHeader_(header);
  return (aliases || []).some(function(alias) {
    return normalized === normalizeForecastHeader_(alias);
  });
}

function findForecastHeader_(values) {
  const maxRows = Math.min(values.length, 20);
  const fieldNames = Object.keys(FORECAST_CFG.HEADER_ALIASES || {});

  for (let r = 0; r < maxRows; r++) {
    const headers = (values[r] || []).map(function(v) {
      return String(v == null ? '' : v).trim();
    });

    const fieldMap = {};

    fieldNames.forEach(function(field) {
      const aliases = FORECAST_CFG.HEADER_ALIASES[field] || [];
      for (let c = 0; c < headers.length; c++) {
        if (forecastHeaderMatches_(headers[c], aliases)) {
          fieldMap[field] = c;
          break;
        }
      }
    });

    const missing = (FORECAST_CFG.REQUIRED_FIELDS || []).filter(function(field) {
      return fieldMap[field] === undefined;
    });

    if (!missing.length) {
      return {
        rowIndex: r,
        headers: headers,
        fieldMap: fieldMap,
        missingFields: []
      };
    }
  }

  return null;
}

function forecastCanonicalHubKey_(value) {
  let key = normalizeStationName_(value);
  if (!key) return '';

  // Historical Forecast and Permission sometimes differ only by a trailing
  // operational suffix, e.g. "51-HCM D2/Cat Lai" vs "51-HCM D2/Cat Lai CH".
  // Strip only known trailing suffix tokens; do not use fuzzy matching because
  // permission mapping must remain deterministic and secure.
  key = key
    .replace(/\s+(?:ch|hub|station)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return key;
}

function buildForecastStationMatcher_(stations, allowedHubCodes) {
  const allowedSet = makeHubSet_(allowedHubCodes || []);
  const exact = {};
  const canonicalBuckets = {};

  (stations || []).forEach(function(station) {
    if (!allowedSet[normalizeCompare_(station.hubCode)]) return;

    const exactKey = normalizeStationName_(station.hubName);
    if (exactKey && !exact[exactKey]) exact[exactKey] = station;

    const canonicalKey = forecastCanonicalHubKey_(station.hubName);
    if (!canonicalKey) return;
    if (!canonicalBuckets[canonicalKey]) canonicalBuckets[canonicalKey] = [];
    canonicalBuckets[canonicalKey].push(station);
  });

  return {
    resolve: function(hubName) {
      const exactKey = normalizeStationName_(hubName);
      if (exact[exactKey]) return exact[exactKey];

      const canonicalKey = forecastCanonicalHubKey_(hubName);
      const bucket = canonicalBuckets[canonicalKey] || [];
      return bucket.length === 1 ? bucket[0] : null;
    }
  };
}


function buildForecastModel_() {
  const ss = getDb_();
  const sheet = findForecastSheet_(ss);

  if (!sheet) {
    return {
      sheetFound: false,
      sheetName: '',
      generatedAt: new Date().toISOString(),
      headerRow: 0,
      dates: [],
      rows: []
    };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    return {
      sheetFound: true,
      sheetName: sheet.getName(),
      generatedAt: new Date().toISOString(),
      headerRow: 0,
      dates: [],
      rows: []
    };
  }

  const dispAll = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const rawAll = dispAll; // one batched Sheet read; parsers handle displayed strings
  const headerInfo = findForecastHeader_(dispAll);

  if (!headerInfo) {
    throw new Error(
      'FORECAST_HEADER_NOT_FOUND: Sheet "' + sheet.getName() +
      '" thiếu một hoặc nhiều header Historical Forecast bắt buộc.'
    );
  }

  const map = headerInfo.fieldMap;
  const permission = getPermissionModel_(false);
  const allHubCodes = (permission.stations || []).map(function(st){ return st.hubCode; });
  const stationMatcher = buildForecastStationMatcher_(permission.stations || [], allHubCodes);
  const rows = [];
  const dateSet = {};

  function ci(field) {
    return map[field];
  }

  for (let r = headerInfo.rowIndex + 1; r < rawAll.length; r++) {
    const raw = rawAll[r];
    const disp = dispAll[r];

    const dateKey = forecastDateKey_(
      raw[ci('date')],
      disp[ci('date')]
    );
    const sourceHubName = String(
      disp[ci('hubName')] || raw[ci('hubName')] || ''
    ).trim();

    if (!dateKey || !sourceHubName) continue;

    const matchedStation = stationMatcher.resolve(sourceHubName);
    dateSet[dateKey] = true;

    rows.push({
      rowNumber: r + 1,
      dateKey: dateKey,
      region: String(disp[ci('region')] || raw[ci('region')] || '').trim(),
      province: String(disp[ci('province')] || raw[ci('province')] || '').trim(),
      sourceHubName: sourceHubName,
      hubCode: matchedStation ? matchedStation.hubCode : '',
      hubName: matchedStation ? matchedStation.hubName : sourceHubName,
      zone: matchedStation ? (matchedStation.zone || '') : '',
      district: matchedStation ? (matchedStation.district || '') : '',

      fmForecast: forecastNumber_(raw[ci('fmForecast')], disp[ci('fmForecast')]),
      fmInbound: forecastNumber_(raw[ci('fmInbound')], disp[ci('fmInbound')]),
      fmDifferenceSource: forecastPercentNumber_(raw[ci('fmDifference')], disp[ci('fmDifference')]),
      pickupDone: forecastNumber_(raw[ci('pickupDone')], disp[ci('pickupDone')]),

      lmForecast: forecastNumber_(raw[ci('lmForecast')], disp[ci('lmForecast')]),
      lmInbound: forecastNumber_(raw[ci('lmInbound')], disp[ci('lmInbound')]),
      lmDifferenceSource: forecastPercentNumber_(raw[ci('lmDifference')], disp[ci('lmDifference')]),
      lmLhArrived: forecastNumber_(raw[ci('lmLhArrived')], disp[ci('lmLhArrived')]),
      lmSocTransported: forecastNumber_(raw[ci('lmSocTransported')], disp[ci('lmSocTransported')])
    });
  }

  return {
    sheetFound: true,
    sheetName: sheet.getName(),
    generatedAt: new Date().toISOString(),
    headerRow: headerInfo.rowIndex + 1,
    headers: headerInfo.headers || [],
    fieldMap: headerInfo.fieldMap || {},
    dates: Object.keys(dateSet).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_),
    sourceRows: Math.max(0, lastRow - headerInfo.rowIndex - 1),
    parsedRows: rows.length,
    matchedRows: rows.filter(function(x){ return !!x.hubCode; }).length,
    unmatchedRows: rows.filter(function(x){ return !x.hubCode; }).length,
    rows: rows
  };
}

function forecastDateKey_(rawValue, displayValue) {
  const tz = FORECAST_CFG.TIMEZONE;

  if (
    Object.prototype.toString.call(rawValue) === '[object Date]' &&
    !isNaN(rawValue.getTime())
  ) {
    return Utilities.formatDate(rawValue, tz, 'yyyy-MM-dd');
  }

  const text = String(displayValue || rawValue || '').trim();
  if (!text) return '';

  let m = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  m = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }

  const d = new Date(text);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }

  return '';
}

function normalizeForecastNumericText_(value) {
  let text = String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, '')
    .trim();

  if (!text) return '';

  const hasComma = text.indexOf(',') !== -1;
  const hasDot = text.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    // 5,936.00000  -> 5936.00000
    // 5.936,00000  -> 5936.00000
    if (text.lastIndexOf('.') > text.lastIndexOf(',')) {
      text = text.replace(/,/g, '');
    } else {
      text = text.replace(/\./g, '').replace(/,/g, '.');
    }
  } else if (hasComma) {
    const parts = text.split(',');
    const last = parts[parts.length - 1] || '';

    // A single comma followed by 1/2/4/5+ digits is treated as decimal
    // separator. A 3-digit tail is treated as a thousands group.
    if (parts.length === 2 && last.length !== 3) {
      text = text.replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  }

  return text;
}

function forecastNumber_(rawValue, displayValue) {
  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    return rawValue;
  }

  let source = rawValue;
  if (source == null || source === '') source = displayValue;

  const cleaned = normalizeForecastNumericText_(source)
    .replace(/%/g, '');

  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return 0;

  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

function forecastPercentNumber_(rawValue, displayValue) {
  if (typeof rawValue === 'number' && isFinite(rawValue)) {
    return Math.abs(rawValue) <= 2 ? rawValue * 100 : rawValue;
  }

  let source = rawValue;
  if (source == null || source === '') source = displayValue;

  const cleaned = normalizeForecastNumericText_(source)
    .replace(/%/g, '');

  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;

  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

function forecastDifferencePct_(forecast, inbound) {
  forecast = Number(forecast || 0);
  inbound = Number(inbound || 0);
  if (!isFinite(forecast) || forecast === 0) return null;

  // Signed difference to preserve the Historical Forecast source meaning:
  // inbound below forecast => negative, inbound above forecast => positive.
  return (inbound - forecast) / Math.abs(forecast) * 100;
}

function forecastD1DateKey_() {
  const tz = FORECAST_CFG.TIMEZONE;
  const now = new Date();
  const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return Utilities.formatDate(d1, tz, 'yyyy-MM-dd');
}

function chooseForecastDate_(availableDates, requestedDate) {
  const dates = (availableDates || []).slice().sort().reverse();
  const requested = String(requestedDate || '').trim();

  if (requested && dates.indexOf(requested) !== -1) {
    return requested;
  }

  const d1 = forecastD1DateKey_();

  if (dates.indexOf(d1) !== -1) {
    return d1;
  }

  const notFuture = dates.filter(function(dateKey) {
    return dateKey <= d1;
  });

  return notFuture[0] || dates[0] || d1;
}

function forecastDateLabel_(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateKey || '');
  return m[3] + '/' + m[2] + '/' + m[1];
}

function forecastEmptyAggregate_() {
  return {
    fmForecast: 0,
    fmInbound: 0,
    pickupDone: 0,
    lmForecast: 0,
    lmInbound: 0,
    lmLhArrived: 0,
    lmSocTransported: 0,
    rowCount: 0
  };
}

function forecastAddRow_(agg, row) {
  agg.fmForecast += Number(row.fmForecast || 0);
  agg.fmInbound += Number(row.fmInbound || 0);
  agg.pickupDone += Number(row.pickupDone || 0);
  agg.lmForecast += Number(row.lmForecast || 0);
  agg.lmInbound += Number(row.lmInbound || 0);
  agg.lmLhArrived += Number(row.lmLhArrived || 0);
  agg.lmSocTransported += Number(row.lmSocTransported || 0);
  agg.rowCount += 1;
  return agg;
}

function finalizeForecastAggregate_(agg) {
  agg = agg || forecastEmptyAggregate_();

  return {
    fmForecast: agg.fmForecast,
    fmInbound: agg.fmInbound,
    fmDifference: forecastDifferencePct_(agg.fmForecast, agg.fmInbound),
    pickupDone: agg.pickupDone,
    lmForecast: agg.lmForecast,
    lmInbound: agg.lmInbound,
    lmDifference: forecastDifferencePct_(agg.lmForecast, agg.lmInbound),
    lmLhArrived: agg.lmLhArrived,
    lmSocTransported: agg.lmSocTransported,
    rowCount: agg.rowCount
  };
}

function buildForecastHubRows_(rows) {
  const grouped = {};

  (rows || []).forEach(function(row) {
    const hubCode = row.permissionHubCode || row.hubCode || '';
    const hubName = row.permissionHubName || row.hubName || '';
    if (!hubCode) return;

    const codeKey = normalizeCompare_(hubCode);
    if (!grouped[codeKey]) {
      grouped[codeKey] = {
        hubCode: hubCode,
        hubName: hubName,
        zone: row.permissionZone || row.zone || '',
        district: row.permissionDistrict || row.district || '',
        aggregate: forecastEmptyAggregate_()
      };
    }

    forecastAddRow_(grouped[codeKey].aggregate, row);
  });

  return Object.keys(grouped)
    .map(function(key) {
      const g = grouped[key];
      const a = finalizeForecastAggregate_(g.aggregate);

      return {
        hubCode: g.hubCode,
        hubName: g.hubName,
        zone: g.zone,
        district: g.district,
        fmForecast: a.fmForecast,
        fmInbound: a.fmInbound,
        fmDifference: a.fmDifference,
        pickupDone: a.pickupDone,
        lmForecast: a.lmForecast,
        lmInbound: a.lmInbound,
        lmDifference: a.lmDifference,
        lmLhArrived: a.lmLhArrived,
        lmSocTransported: a.lmSocTransported,
        sourceRows: a.rowCount
      };
    })
    .sort(function(a, b) {
      return String(a.hubName).localeCompare(String(b.hubName));
    });
}

function buildForecastTrend_(scopeRows, availableDates) {
  const byDate = {};

  (scopeRows || []).forEach(function(row) {
    if (!byDate[row.dateKey]) {
      byDate[row.dateKey] = forecastEmptyAggregate_();
    }
    forecastAddRow_(byDate[row.dateKey], row);
  });

  return (availableDates || [])
    .slice(0, FORECAST_CFG.MAX_TREND_DAYS)
    .map(function(dateKey) {
      const a = finalizeForecastAggregate_(byDate[dateKey] || forecastEmptyAggregate_());
      return {
        date: dateKey,
        dateLabel: forecastDateLabel_(dateKey),
        fmForecast: a.fmForecast,
        fmInbound: a.fmInbound,
        fmDifference: a.fmDifference,
        pickupDone: a.pickupDone,
        lmForecast: a.lmForecast,
        lmInbound: a.lmInbound,
        lmDifference: a.lmDifference,
        lmLhArrived: a.lmLhArrived,
        lmSocTransported: a.lmSocTransported
      };
    });
}

function getForecastDashboard(path, dateKey, forceRefresh) {
  const access = requireAccess_(['dashboard']);
  const resolved = assertDrillPathAccess_(access, path || {});
  const model = getForecastModel_(forceRefresh === true);

  if (!model.sheetFound) {
    return {
      ok: true,
      sheetFound: false,
      sheetName: '',
      date: String(dateKey || ''),
      dates: [],
      rows: [],
      trend: [],
      summary: finalizeForecastAggregate_(forecastEmptyAggregate_()),
      view: resolved.view,
      path: resolved.path,
      serverTime: new Date().toISOString()
    };
  }

  const permission = getPermissionModel_(false);
  const allowedHubCodes = resolved.view.hubCodes || [];
  const matcher = buildForecastStationMatcher_(
    permission.stations || [],
    allowedHubCodes
  );

  const scopeRows = (model.rows || []).map(function(row) {
    const station = matcher.resolve(row.hubName);
    if (!station) return null;

    // Clone the cached source row and attach the authorized Permission station.
    // This keeps authorization based on Permission while allowing Historical
    // Forecast naming variants such as a trailing "CH" suffix.
    return Object.assign({}, row, {
      permissionHubCode: station.hubCode,
      permissionHubName: station.hubName,
      permissionZone: station.zone || '',
      permissionDistrict: station.district || ''
    });
  }).filter(Boolean);

  const scopeDateSet = {};
  scopeRows.forEach(function(row) {
    scopeDateSet[row.dateKey] = true;
  });

  const scopeDates = Object.keys(scopeDateSet).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_);
  const selectedDate = chooseForecastDate_(scopeDates, dateKey);

  const selectedRows = scopeRows.filter(function(row) {
    return row.dateKey === selectedDate;
  });

  const hubRows = buildForecastHubRows_(selectedRows);
  const summaryAgg = forecastEmptyAggregate_();
  selectedRows.forEach(function(row) {
    forecastAddRow_(summaryAgg, row);
  });

  const trend = buildForecastTrend_(scopeRows, scopeDates);

  return {
    ok: true,
    sheetFound: true,
    sheetName: model.sheetName,
    headerRow: model.headerRow || 1,
    generatedAt: model.generatedAt || '',
    date: selectedDate,
    dateLabel: forecastDateLabel_(selectedDate),
    d1Date: forecastD1DateKey_(),
    isD1: selectedDate === forecastD1DateKey_(),
    dates: scopeDates.map(function(key) {
      return {
        value: key,
        label: forecastDateLabel_(key)
      };
    }),
    path: resolved.path,
    view: resolved.view,
    scopeHubs: allowedHubCodes.length,
    matchedHubs: hubRows.length,
    missingHubs: Math.max(0, allowedHubCodes.length - hubRows.length),
    summary: finalizeForecastAggregate_(summaryAgg),
    rows: hubRows,
    trend: trend,
    mappingMode: 'EXACT_OR_SAFE_CANONICAL',
    aggregationNote:
      'Count metrics are summed. % Difference is recalculated as (Inbound - Forecast) / Forecast, preserving the source sign and never averaging hub percentages.',
    serverTime: new Date().toISOString()
  };
}


/**
 * Lightweight Daily Drill detail API.
 * Loads only one date's HUB rows for the already-authorized org path.
 * Used by the +/- expander in Dashboard > Daily Drill so opening a date
 * does not reload the whole dashboard or rebuild the 31-day trend payload.
 */
function forecastDateToUtc_(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function forecastUtcToDateKey_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return date.getUTCFullYear() + '-' + ('0' + (date.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + date.getUTCDate()).slice(-2);
}

function addForecastDays_(dateKey, days) {
  const d = forecastDateToUtc_(dateKey);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return forecastUtcToDateKey_(d);
}

function forecastPeriodBounds_(anchorDate, mode) {
  mode = String(mode || 'DAY').trim().toUpperCase();
  if (['DAY','WEEK','MONTH'].indexOf(mode) === -1) mode = 'DAY';
  const anchor = forecastDateToUtc_(anchorDate);
  if (!anchor) return { mode:mode, start:anchorDate, end:anchorDate, label:forecastDateLabel_(anchorDate) };

  let start = new Date(anchor.getTime());
  let end = new Date(anchor.getTime());

  if (mode === 'WEEK') {
    const day = anchor.getUTCDay(); // 0 Sun .. 6 Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + mondayOffset);
    end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else if (mode === 'MONTH') {
    start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  }

  const startKey = forecastUtcToDateKey_(start);
  const endKey = forecastUtcToDateKey_(end);
  let label = forecastDateLabel_(anchorDate);
  if (mode === 'WEEK') label = forecastDateLabel_(startKey) + ' – ' + forecastDateLabel_(endKey);
  if (mode === 'MONTH') label = ('0' + (start.getUTCMonth() + 1)).slice(-2) + '/' + start.getUTCFullYear();

  return { mode:mode, start:startKey, end:endKey, label:label };
}

function previousForecastPeriod_(bounds) {
  const mode = bounds.mode || 'DAY';
  if (mode === 'DAY') {
    const prev = addForecastDays_(bounds.start, -1);
    return forecastPeriodBounds_(prev, 'DAY');
  }
  if (mode === 'WEEK') {
    return forecastPeriodBounds_(addForecastDays_(bounds.start, -7), 'WEEK');
  }
  const d = forecastDateToUtc_(bounds.start);
  if (!d) return forecastPeriodBounds_(bounds.start, 'MONTH');
  d.setUTCMonth(d.getUTCMonth() - 1);
  return forecastPeriodBounds_(forecastUtcToDateKey_(d), 'MONTH');
}

function forecastComparableWindow_(bounds, anchorDate) {
  bounds = Object.assign({}, bounds || {});
  if (!bounds.start || !bounds.end) return bounds;
  if (bounds.mode === 'DAY') return bounds;
  if (anchorDate && anchorDate >= bounds.start && anchorDate < bounds.end) {
    bounds.end = anchorDate;
    bounds.label = bounds.mode === 'WEEK'
      ? forecastDateLabel_(bounds.start) + ' – ' + forecastDateLabel_(bounds.end) + ' (WTD)'
      : forecastDateLabel_(bounds.start) + ' – ' + forecastDateLabel_(bounds.end) + ' (MTD)';
  }
  return bounds;
}

function previousComparableForecastPeriod_(currentWindow) {
  const fullPrevious = previousForecastPeriod_(currentWindow);
  if (!currentWindow || currentWindow.mode === 'DAY') return fullPrevious;
  const start = forecastDateToUtc_(currentWindow.start);
  const end = forecastDateToUtc_(currentWindow.end);
  if (!start || !end) return fullPrevious;
  const elapsedDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  fullPrevious.end = addForecastDays_(fullPrevious.start, elapsedDays);
  fullPrevious.label = fullPrevious.mode === 'WEEK'
    ? forecastDateLabel_(fullPrevious.start) + ' – ' + forecastDateLabel_(fullPrevious.end)
    : forecastDateLabel_(fullPrevious.start) + ' – ' + forecastDateLabel_(fullPrevious.end);
  return fullPrevious;
}

function forecastRowsWithin_(rows, bounds) {
  return (rows || []).filter(function(row) {
    return row.dateKey >= bounds.start && row.dateKey <= bounds.end;
  });
}

function forecastGapDelta_(current, previous) {
  if (current == null || previous == null || !isFinite(Number(current)) || !isFinite(Number(previous))) return null;
  return Number(current) - Number(previous);
}

function buildForecastHubPeriodRows_(currentRows, previousRows) {
  const current = buildForecastHubRows_(currentRows || []);
  const previous = buildForecastHubRows_(previousRows || []);
  const prevMap = {};
  previous.forEach(function(row) { prevMap[normalizeCompare_(row.hubCode)] = row; });

  return current.map(function(row) {
    const prev = prevMap[normalizeCompare_(row.hubCode)] || null;
    return Object.assign({}, row, {
      previousFmDifference: prev ? prev.fmDifference : null,
      previousLmDifference: prev ? prev.lmDifference : null,
      fmGapDelta: forecastGapDelta_(row.fmDifference, prev ? prev.fmDifference : null),
      lmGapDelta: forecastGapDelta_(row.lmDifference, prev ? prev.lmDifference : null),
      previousFmForecast: prev ? prev.fmForecast : 0,
      previousFmInbound: prev ? prev.fmInbound : 0,
      previousLmForecast: prev ? prev.lmForecast : 0,
      previousLmInbound: prev ? prev.lmInbound : 0
    });
  });
}

function forecastMonitoringStatus_(gap, threshold) {
  threshold = Number(threshold || 10);
  if (gap == null || !isFinite(Number(gap))) return 'NO_DATA';
  return Math.abs(Number(gap)) >= threshold ? 'WATCH' : 'NORMAL';
}

function buildForecastDrivers_(hubRows, mode, totalForecast, maxItems) {
  mode = String(mode || 'FM').toUpperCase();
  totalForecast = Number(totalForecast || 0);
  if (!(totalForecast > 0)) return [];
  maxItems = Number(maxItems || 5);

  return (hubRows || []).map(function(row) {
    const forecast = mode === 'FM' ? Number(row.fmForecast || 0) : Number(row.lmForecast || 0);
    const inbound = mode === 'FM' ? Number(row.fmInbound || 0) : Number(row.lmInbound || 0);
    const gap = mode === 'FM' ? row.fmDifference : row.lmDifference;
    const contributionPp = (inbound - forecast) / totalForecast * 100;
    return {
      hubCode:row.hubCode,
      hubName:row.hubName,
      gap:gap,
      contributionPp:contributionPp
    };
  }).sort(function(a,b) {
    return Math.abs(b.contributionPp) - Math.abs(a.contributionPp);
  }).slice(0, maxItems);
}

function buildForecastDailyTrendWithDelta_(scopeRows, availableDates) {
  const trend = buildForecastTrend_(scopeRows, availableDates);
  const byDate = {};
  trend.forEach(function(row) { byDate[row.date] = row; });
  return trend.map(function(row) {
    const prev = byDate[addForecastDays_(row.date, -1)] || null;
    return Object.assign({}, row, {
      fmGapDelta: forecastGapDelta_(row.fmDifference, prev ? prev.fmDifference : null),
      lmGapDelta: forecastGapDelta_(row.lmDifference, prev ? prev.lmDifference : null)
    });
  });
}

function forecastPeriodKey_(dateKey, mode) {
  const b = forecastPeriodBounds_(dateKey, mode);
  return b.start;
}

function buildForecastPeriodTrend_(scopeRows, mode, anchorDate, maxItems) {
  mode = String(mode || 'DAY').toUpperCase();
  maxItems = Number(maxItems || (mode === 'DAY' ? 31 : 12));
  const groups = {};

  (scopeRows || []).forEach(function(row) {
    if (anchorDate && row.dateKey > anchorDate) return;
    const key = forecastPeriodKey_(row.dateKey, mode);
    if (!groups[key]) groups[key] = forecastEmptyAggregate_();
    forecastAddRow_(groups[key], row);
  });

  const keys = Object.keys(groups).sort().reverse().filter(function(key) {
    return !anchorDate || key <= forecastPeriodKey_(anchorDate, mode);
  }).slice(0, maxItems);

  return keys.map(function(key, index) {
    const agg = finalizeForecastAggregate_(groups[key]);
    const bounds = forecastPeriodBounds_(key, mode);
    const prevKey = keys[index + 1];
    const prev = prevKey ? finalizeForecastAggregate_(groups[prevKey]) : null;
    return {
      key:key,
      label:bounds.label,
      start:bounds.start,
      end:bounds.end,
      fmForecast:agg.fmForecast,
      fmInbound:agg.fmInbound,
      fmDifference:agg.fmDifference,
      fmGapDelta:forecastGapDelta_(agg.fmDifference, prev ? prev.fmDifference : null),
      lmForecast:agg.lmForecast,
      lmInbound:agg.lmInbound,
      lmDifference:agg.lmDifference,
      lmGapDelta:forecastGapDelta_(agg.lmDifference, prev ? prev.lmDifference : null),
      pickupDone:agg.pickupDone,
      lmLhArrived:agg.lmLhArrived,
      lmSocTransported:agg.lmSocTransported
    };
  });
}


function getForecastClientMasterCacheUncached_(forceRefresh) {
  const access = requireAccess_(['dashboard']);
  const permission = getPermissionModel_(false);
  const hubCodes = fullAuthorizedHubCodes_(access, permission);
  const allowed = {};

  hubCodes.forEach(function(code) {
    allowed[normalizeCompare_(code)] = true;
  });

  // Explicitly opening Gap Overview or refreshing it rebuilds the fact from
  // Historical Forecast. Evicting cache alone would reload an outdated fact.
  if (allowHeavyForceRefresh_(access, 'forecast-client-source', forceRefresh === true)) {
    materializeForecastFact_();
  }

  const model = readForecastFact_();

  if (!model) {
    return {
      ok:true,
      dataReady:false,
      sheetFound:false,
      sheetName:FORECAST_CFG.SHEET_NAME,
      rows:[],
      dates:[],
      authorizedHubCodes:hubCodes,
      generatedAt:'',
      serverTime:new Date().toISOString()
    };
  }

  // Compact browser payload:
  // [date, hubCode, hubName, zone, district,
  //  fmForecast, fmInbound, pickupDone,
  //  lmForecast, lmInbound, lmLhArrived, lmSocTransported]
  const rows = [];
  const dateSet = {};

  (model.rows || []).forEach(function(row) {
    if (!allowed[normalizeCompare_(row.hubCode)]) return;

    rows.push([
      row.dateKey,
      row.hubCode,
      row.hubName,
      row.zone || '',
      row.district || '',
      Number(row.fmForecast || 0),
      Number(row.fmInbound || 0),
      Number(row.pickupDone || 0),
      Number(row.lmForecast || 0),
      Number(row.lmInbound || 0),
      Number(row.lmLhArrived || 0),
      Number(row.lmSocTransported || 0)
    ]);

    dateSet[row.dateKey] = true;
  });

  const dates = Object.keys(dateSet)
    .map(factDateKey_)
    .filter(Boolean)
    .sort(factSortDateDesc_);

  return {
    ok:true,
    dataReady:true,
    sheetFound:true,
    sheetName:model.sheetName || FORECAST_CFG.SHEET_NAME,
    generatedAt:model.generatedAt || '',
    rows:rows,
    dates:dates,
    authorizedHubCodes:hubCodes,
    serverTime:new Date().toISOString()
  };
}

function getForecastAnalystDashboard(path, anchorDate, periodMode, selectedHubCodes, forceRefresh) {
  const access = requireAccess_(['dashboard']);
  const effectiveForce = allowHeavyForceRefresh_(access, 'forecast', forceRefresh === true);
  const resolved = assertDrillPathAccess_(access, path || {});
  const model = getForecastModel_(effectiveForce);
  const allowedHubCodes = resolveSelectedAuthorizedHubCodes_(resolved.view, selectedHubCodes);
  const mode = ['DAY','WEEK','MONTH'].indexOf(String(periodMode || 'DAY').toUpperCase()) !== -1
    ? String(periodMode || 'DAY').toUpperCase()
    : 'DAY';

  if (!model.sheetFound) {
    return {
      ok:true, sheetFound:false, sheetName:'', mode:mode, anchorDate:String(anchorDate || ''),
      dates:[], rows:[], trend:[], dailyTrend:[], summary:finalizeForecastAggregate_(forecastEmptyAggregate_()),
      previousSummary:finalizeForecastAggregate_(forecastEmptyAggregate_()), selectedHubCodes:allowedHubCodes,
      view:resolved.view, path:resolved.path, serverTime:new Date().toISOString()
    };
  }

  const allowedSet = makeHubSet_(allowedHubCodes);
  const scopeRows = (model.rows || []).filter(function(row) {
    return row.hubCode && allowedSet[normalizeCompare_(row.hubCode)];
  });

  const dateSet = {};
  scopeRows.forEach(function(row) { dateSet[row.dateKey] = true; });
  const scopeDates = Object.keys(dateSet).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_);
  const selectedAnchor = chooseForecastDate_(scopeDates, anchorDate);
  const currentPeriod = forecastComparableWindow_(forecastPeriodBounds_(selectedAnchor, mode), selectedAnchor);
  const previousPeriod = previousComparableForecastPeriod_(currentPeriod);
  const currentRows = forecastRowsWithin_(scopeRows, currentPeriod);
  const previousRows = forecastRowsWithin_(scopeRows, previousPeriod);

  const currentAgg = forecastEmptyAggregate_();
  currentRows.forEach(function(row) { forecastAddRow_(currentAgg, row); });
  const previousAgg = forecastEmptyAggregate_();
  previousRows.forEach(function(row) { forecastAddRow_(previousAgg, row); });
  const summary = finalizeForecastAggregate_(currentAgg);
  const previousSummary = finalizeForecastAggregate_(previousAgg);
  const hubRows = buildForecastHubPeriodRows_(currentRows, previousRows);
  const watchThreshold = 10;

  hubRows.forEach(function(row) {
    row.fmStatus = forecastMonitoringStatus_(row.fmDifference, watchThreshold);
    row.lmStatus = forecastMonitoringStatus_(row.lmDifference, watchThreshold);
  });

  const fmWatchCount = hubRows.filter(function(row) { return row.fmStatus === 'WATCH'; }).length;
  const lmWatchCount = hubRows.filter(function(row) { return row.lmStatus === 'WATCH'; }).length;

  return {
    ok:true,
    sheetFound:true,
    sheetName:model.sheetName,
    headerRow:model.headerRow || 1,
    generatedAt:model.generatedAt || '',
    mode:mode,
    anchorDate:selectedAnchor,
    anchorDateLabel:forecastDateLabel_(selectedAnchor),
    dates:scopeDates.map(function(key) { return { value:key, label:forecastDateLabel_(key) }; }),
    currentPeriod:currentPeriod,
    previousPeriod:previousPeriod,
    path:resolved.path,
    view:resolved.view,
    selectedHubCodes:allowedHubCodes,
    scopeHubs:allowedHubCodes.length,
    matchedHubs:hubRows.length,
    missingHubs:Math.max(0, allowedHubCodes.length - hubRows.length),
    summary:summary,
    previousSummary:previousSummary,
    comparison:{
      fmGapDelta:forecastGapDelta_(summary.fmDifference, previousSummary.fmDifference),
      lmGapDelta:forecastGapDelta_(summary.lmDifference, previousSummary.lmDifference),
      previousLabel:previousPeriod.label
    },
    watchThresholdPct:watchThreshold,
    exceptions:{ fm:fmWatchCount, lm:lmWatchCount, any:hubRows.filter(function(row){ return row.fmStatus === 'WATCH' || row.lmStatus === 'WATCH'; }).length },
    rows:hubRows,
    dailyTrend:buildForecastDailyTrendWithDelta_(scopeRows, scopeDates),
    trend:buildForecastPeriodTrend_(scopeRows, mode, selectedAnchor, mode === 'DAY' ? 31 : 12),
    drivers:{
      fm:buildForecastDrivers_(hubRows, 'FM', summary.fmForecast, 5),
      lm:buildForecastDrivers_(hubRows, 'LM', summary.lmForecast, 5)
    },
    mappingMode:'EXACT_OR_SAFE_CANONICAL',
    aggregationNote:'Day / Week / Month totals sum Forecast and Inbound first, then recalculate Gap = (Inbound - Forecast) / Forecast. Gap percentages are never averaged.',
    serverTime:new Date().toISOString()
  };
}

/**
 * Lightweight Daily Drill detail API with optional multi-HUB filter.
 */
function getForecastDailyHubDetail(path, dateKey, selectedHubCodes, forceRefresh) {
  if (typeof selectedHubCodes === 'boolean') {
    forceRefresh = selectedHubCodes;
    selectedHubCodes = [];
  }

  const access = requireAccess_(['dashboard']);
  const effectiveForce = allowHeavyForceRefresh_(access, 'forecast-detail', forceRefresh === true);
  const resolved = assertDrillPathAccess_(access, path || {});
  const model = getForecastModel_(effectiveForce);
  const requestedDate = factDateKey_(dateKey);
  const allowedHubCodes = resolveSelectedAuthorizedHubCodes_(resolved.view, selectedHubCodes);

  if (!model.sheetFound) {
    return {
      ok:true, sheetFound:false, sheetName:'', date:requestedDate,
      dateLabel:forecastDateLabel_(requestedDate), path:resolved.path, view:resolved.view,
      rows:[], matchedHubs:0, selectedHubCodes:allowedHubCodes, serverTime:new Date().toISOString()
    };
  }

  const allowedSet = makeHubSet_(allowedHubCodes);
  const selectedRows = (model.rows || []).filter(function(row) {
    if (requestedDate && row.dateKey !== requestedDate) return false;
    return row.hubCode && allowedSet[normalizeCompare_(row.hubCode)];
  });

  const rows = buildForecastHubRows_(selectedRows);
  return {
    ok:true, sheetFound:true, sheetName:model.sheetName, date:requestedDate,
    dateLabel:forecastDateLabel_(requestedDate), path:resolved.path, view:resolved.view,
    scopeHubs:allowedHubCodes.length, matchedHubs:rows.length, selectedHubCodes:allowedHubCodes,
    rows:rows, serverTime:new Date().toISOString()
  };
}

function debugHistoricalForecastMapping() {
  const admin = requireAdmin_();
  const model = getForecastModel_(true);
  const permission = getPermissionModel_(false);
  const allHubCodes = (permission.stations || []).map(function(s) { return s.hubCode; });
  const matcher = buildForecastStationMatcher_(permission.stations || [], allHubCodes);

  const matched = {};
  const unmatched = {};

  (model.rows || []).forEach(function(row) {
    if (row.hubCode) matched[row.sourceHubName || row.hubName] = row.hubName;
    else unmatched[row.sourceHubName || row.hubName] = true;
  });

  return {
    ok: true,
    checkedBy: admin.email,
    sheetName: model.sheetName || '',
    headerRow: model.headerRow || 0,
    headers: model.headers || [],
    fieldMap: model.fieldMap || {},
    rowCount: (model.rows || []).length,
    dateCount: (model.dates || []).length,
    permissionStationCount: (permission.stations || []).length,
    matchedHistoricalHubCount: Object.keys(matched).length,
    unmatchedHistoricalHubCount: Object.keys(unmatched).length,
    unmatchedHistoricalHubs: Object.keys(unmatched).sort().slice(0, 100),
    sampleParsedRows: (model.rows || []).slice(0, 10).map(function(r) {
      return {
        rowNumber: r.rowNumber,
        date: r.dateKey,
        region: r.region,
        province: r.province,
        hubName: r.hubName,
        fmForecast: r.fmForecast,
        fmInbound: r.fmInbound,
        fmDifferenceSource: r.fmDifferenceSource,
        pickupDone: r.pickupDone,
        lmForecast: r.lmForecast,
        lmInbound: r.lmInbound,
        lmDifferenceSource: r.lmDifferenceSource,
        lmLhArrived: r.lmLhArrived,
        lmSocTransported: r.lmSocTransported
      };
    }),
    checkedAt: new Date().toISOString()
  };
}

function refreshForecastCache() {
  requireAdmin_();
  removeChunkedCacheJson_(CACHE_CFG.FORECAST_MODEL_KEY);
  const model = getForecastModel_(true);

  return {
    ok: true,
    sheetFound: model.sheetFound !== false,
    sheetName: model.sheetName || '',
    dateCount: (model.dates || []).length,
    rowCount: (model.rows || []).length,
    refreshedAt: new Date().toISOString()
  };
}


/* ============================================================
   ORG KPI DRILL-DOWN ENGINE — V7.2
   ------------------------------------------------------------
   AUTH identity never changes while drilling.

   ADMIN -> HCM City Total -> AOM Total -> SUP Total -> HUB
   AOM   -> My AOM Total   -> SUP Total -> HUB
   SUP   -> My SUP Total   -> HUB
   HUB   -> assigned HUB only

   The Permission sheet is the org chart. Relationships are built
   from each station row: AOM email + Sup email + Hub Code/Name.
   ============================================================ */


function mergeStationCatalogs_(primaryStations, extraStations) {
  const work = {};

  function add(s, preferPrimary) {
    if (!s) return;
    const code = String(s.hubCode || '').trim();
    const name = String(s.hubName || code || '').trim();
    const key = normalizeCompare_(code || name);
    if (!key) return;

    if (!work[key]) {
      work[key] = {
        hubCode:code || name,
        hubName:name || code,
        type:s.type || '',
        zone:s.zone || '',
        district:s.district || '',
        address:s.address || '',
        ward:s.ward || '',
        saom:(s.saom || []).slice(),
        aom:(s.aom || []).slice(),
        sup:(s.sup || []).slice(),
        leads:s.leads || {},
        leadEmails:(s.leadEmails || []).slice()
      };
      return;
    }

    if (preferPrimary) {
      const x = work[key];
      if (name) x.hubName = name;
      if (s.type) x.type = s.type;
      if (s.zone) x.zone = s.zone;
      if (s.district) x.district = s.district;
      if (s.address) x.address = s.address;
      if (s.ward) x.ward = s.ward;
      if (s.saom) x.saom = s.saom.slice();
      if (s.aom) x.aom = s.aom.slice();
      if (s.sup) x.sup = s.sup.slice();
      if (s.leadEmails) x.leadEmails = s.leadEmails.slice();
      if (s.leads) x.leads = s.leads;
    }
  }

  (extraStations || []).forEach(function(s){ add(s, false); });
  (primaryStations || []).forEach(function(s){ add(s, true); });

  return Object.keys(work)
    .map(function(k){ return work[k]; })
    .sort(function(a,b){
      return String(a.hubName || '').localeCompare(String(b.hubName || ''));
    });
}

function adminCityStationUniverse_(permissionStations) {
  return (permissionStations || []).slice();
}

function extendedStationByHubCode_(permissionModel, hubCode) {
  return stationByHubCode_(permissionModel, hubCode);
}

function buildDrillContext_(access, permissionModel) {
  const rank = normalizeRank_(access.rank);
  const model = permissionModel || getPermissionModel_(false);
  const permissionStations = (model.stations || []).slice();
  const allStations = rank === 'ADMIN'
    ? adminCityStationUniverse_(permissionStations)
    : permissionStations;
  const allowedStations = rank === 'ADMIN'
    ? allStations
    : filterStationsByHubCodes_(allStations, access.hubCodes || []);

  if (rank === 'ADMIN') {
    const saomEmails = uniqueEmailsFromStations_(allowedStations, 'saom');
    const saoms = saomEmails
      .map(function(email) { return buildSaomDrillNode_(email, allowedStations); })
      .filter(function(node) { return node.hubCount > 0; });

    const aomEmails = uniqueEmailsFromStations_(allowedStations, 'aom');
    const aoms = aomEmails
      .map(function(email) { return buildAomDrillNode_(email, allowedStations); })
      .filter(function(node) { return node.hubCount > 0; });

    const root = {
      level:'CITY',
      value:APP.CITY_VALUE,
      label:APP.CITY_LABEL,
      hubCount:uniqueHubNodes_(allowedStations).length,
      hubs:uniqueHubNodes_(allowedStations)
    };

    return {
      rank:rank,
      rootLevel:'CITY',
      root:root,
      saoms:saoms,
      aoms:aoms,
      defaultPath:{ saomEmail:'', aomEmail:'', supEmail:'', hubCode:'' },
      defaultView:nodeToView_(root),
      stationCount:uniqueHubNodes_(allowedStations).length
    };
  }

  if (rank === 'SAOM') {
    const root = buildSaomDrillNode_(access.email, allowedStations);
    return {
      rank:rank,
      rootLevel:'SAOM',
      root:root,
      saoms:[root],
      aoms:root.aoms || [],
      defaultPath:{ saomEmail:access.email, aomEmail:'', supEmail:'', hubCode:'' },
      defaultView:nodeToView_(root),
      stationCount:allowedStations.length
    };
  }

  if (rank === 'AOM') {
    const root = buildAomDrillNode_(access.email, allowedStations);
    return {
      rank:rank,
      rootLevel:'AOM',
      root:root,
      aoms:[root],
      defaultPath:{ saomEmail:'', aomEmail:access.email, supEmail:'', hubCode:'' },
      defaultView:nodeToView_(root),
      stationCount:allowedStations.length
    };
  }

  if (rank === 'SUP') {
    const root = buildSupDrillNode_(access.email, allowedStations);
    return {
      rank:rank,
      rootLevel:'SUP',
      root:root,
      sups:[root],
      defaultPath:{ saomEmail:'', aomEmail:'', supEmail:access.email, hubCode:'' },
      defaultView:nodeToView_(root),
      stationCount:allowedStations.length
    };
  }

  const hubs = uniqueHubNodes_(allowedStations);
  const root = hubs.length > 1
    ? { level:'HUB_GROUP', value:'MY_HUBS', label:'Assigned HUBs', hubCount:hubs.length, hubs:hubs }
    : (hubs[0] || { level:'HUB', value:'', label:'No assigned Hub', hubCode:'', hubCount:0 });

  return {
    rank:'HUB',
    rootLevel:hubs.length > 1 ? 'HUB_GROUP' : 'HUB',
    root:root,
    hubs:hubs,
    defaultPath:{ saomEmail:'', aomEmail:'', supEmail:'', hubCode:hubs.length === 1 ? (hubs[0].value || '') : '' },
    defaultView:nodeToView_(root),
    stationCount:hubs.length
  };
}

function buildSaomDrillNode_(email, candidateStations) {
  email = normalizeEmail_(email);
  const stations = (candidateStations || []).filter(function(s) {
    return emailListHas_(s.saom, email);
  });
  const aomEmails = uniqueEmailsFromStations_(stations, 'aom');
  const aoms = aomEmails
    .map(function(aomEmail) { return buildAomDrillNode_(aomEmail, stations); })
    .filter(function(node) { return node.hubCount > 0; });

  return {
    level:'SAOM',
    value:email,
    email:email,
    label:permissionDisplayNameForEmail_(email),
    displayName:permissionDisplayNameForEmail_(email),
    hubCount:uniqueHubNodes_(stations).length,
    hubs:uniqueHubNodes_(stations),
    aoms:aoms
  };
}

function buildAomDrillNode_(email, candidateStations) {
  email = normalizeEmail_(email);
  const stations = (candidateStations || []).filter(function(s) {
    return emailListHas_(s.aom, email);
  });
  const supEmails = uniqueEmailsFromStations_(stations, 'sup');
  const sups = supEmails
    .map(function(supEmail) { return buildSupDrillNode_(supEmail, stations); })
    .filter(function(node) { return node.hubCount > 0; });

  return {
    level:'AOM',
    value:email,
    email:email,
    label:permissionDisplayNameForEmail_(email),
    displayName:permissionDisplayNameForEmail_(email),
    hubCount:uniqueHubNodes_(stations).length,
    hubs:uniqueHubNodes_(stations),
    sups:sups
  };
}

function buildSupDrillNode_(email, candidateStations) {
  email = normalizeEmail_(email);
  const stations = (candidateStations || []).filter(function(s) {
    return emailListHas_(s.sup, email);
  });
  const hubs = uniqueHubNodes_(stations);
  return {
    level: 'SUP',
    value: email,
    email: email,
    label: permissionDisplayNameForEmail_(email),
    displayName: permissionDisplayNameForEmail_(email),
    hubCount: hubs.length,
    hubs: hubs
  };
}

function uniqueEmailsFromStations_(stations, field) {
  const seen = {};
  const out = [];
  (stations || []).forEach(function(station) {
    (station[field] || []).forEach(function(email) {
      email = normalizeEmail_(email);
      if (!email || seen[email]) return;
      seen[email] = true;
      out.push(email);
    });
  });
  return out.sort(function(a,b) {
    return permissionDisplayNameForEmail_(a).localeCompare(permissionDisplayNameForEmail_(b));
  });
}

function uniqueHubNodes_(stations) {
  const seen = {};
  const out = [];
  (stations || []).forEach(function(s) {
    const key = normalizeCompare_(s.hubCode);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({
      level: 'HUB',
      value: s.hubCode,
      hubCode: s.hubCode,
      label: s.hubName,
      hubName: s.hubName,
      hubCount: 1,
      zone: s.zone || '',
      district: s.district || ''
    });
  });
  return out.sort(function(a,b) { return String(a.label).localeCompare(String(b.label)); });
}

function filterStationsByHubCodes_(stations, hubCodes) {
  const allowed = makeHubSet_(hubCodes || []);
  return (stations || []).filter(function(s) {
    return allowed[normalizeCompare_(s.hubCode)];
  });
}

function emailListHas_(list, email) {
  email = normalizeEmail_(email);
  return (list || []).some(function(x) {
    return normalizeEmail_(x) === email;
  });
}

function nodeToView_(node) {
  if (!node) return { type:'HUB', value:'', label:'', hubCount:0, hubCodes:[] };
  if (node.level === 'HUB') {
    return {
      type:'HUB', value:node.value, label:node.label,
      hubCount:node.value ? 1 : 0,
      hubCodes:node.value ? [node.value] : []
    };
  }

  const hubs = node.hubs || [];
  return {
    type:node.level,
    value:node.value,
    label:node.label,
    email:node.email || '',
    hubCount:hubs.length,
    hubCodes:hubs.map(function(h) { return h.value; })
  };
}

function assertDrillPathAccess_(access, path) {
  path = path || {};
  const rank = normalizeRank_(access.rank);
  const ctx = buildDrillContext_(access);
  const saomEmail = normalizeEmail_(path.saomEmail || path.saom || '');
  const aomEmail = normalizeEmail_(path.aomEmail || path.aom || '');
  const supEmail = normalizeEmail_(path.supEmail || path.sup || '');
  const hubCode = cleanText_(path.hubCode || path.hub || '', 500);

  function descendFromAom_(aom, basePath) {
    if (!supEmail) return { path:basePath, view:nodeToView_(aom) };
    const sup = (aom.sups || []).find(function(x) { return x.email === supEmail; });
    if (!sup) throw new Error('DRILL_SUP_DENIED:' + supEmail);
    const supPath = Object.assign({}, basePath, { supEmail:supEmail, hubCode:'' });
    if (!hubCode) return { path:supPath, view:nodeToView_(sup) };
    const hub = (sup.hubs || []).find(function(x) { return normalizeCompare_(x.value) === normalizeCompare_(hubCode); });
    if (!hub) throw new Error('DRILL_HUB_DENIED:' + hubCode);
    return { path:Object.assign({}, supPath, { hubCode:hub.value }), view:nodeToView_(hub) };
  }

  if (rank === 'ADMIN') {
    let saom = null;
    let aomPool = ctx.aoms || [];

    if (saomEmail) {
      saom = (ctx.saoms || []).find(function(x) { return x.email === saomEmail; });
      if (!saom) throw new Error('DRILL_SAOM_DENIED:' + saomEmail);
      if (!aomEmail) {
        return { path:{saomEmail:saomEmail,aomEmail:'',supEmail:'',hubCode:''}, view:nodeToView_(saom) };
      }
      aomPool = saom.aoms || [];
    } else if (!aomEmail) {
      return { path:{saomEmail:'',aomEmail:'',supEmail:'',hubCode:''}, view:nodeToView_(ctx.root) };
    }

    const aom = aomPool.find(function(x) { return x.email === aomEmail; });
    if (!aom) throw new Error('DRILL_AOM_DENIED:' + aomEmail);
    return descendFromAom_(aom, {saomEmail:saomEmail,aomEmail:aomEmail,supEmail:'',hubCode:''});
  }

  if (rank === 'SAOM') {
    if (saomEmail && saomEmail !== normalizeEmail_(access.email)) throw new Error('DRILL_SAOM_DENIED:' + saomEmail);
    const root = ctx.root;
    if (!aomEmail) {
      return { path:{saomEmail:access.email,aomEmail:'',supEmail:'',hubCode:''}, view:nodeToView_(root) };
    }
    const aom = (root.aoms || []).find(function(x) { return x.email === aomEmail; });
    if (!aom) throw new Error('DRILL_AOM_DENIED:' + aomEmail);
    return descendFromAom_(aom, {saomEmail:access.email,aomEmail:aomEmail,supEmail:'',hubCode:''});
  }

  if (rank === 'AOM') {
    if (aomEmail && aomEmail !== normalizeEmail_(access.email)) throw new Error('DRILL_AOM_DENIED:' + aomEmail);
    const root = ctx.root;
    return descendFromAom_(root, {saomEmail:'',aomEmail:access.email,supEmail:'',hubCode:''});
  }

  if (rank === 'SUP') {
    if (supEmail && supEmail !== normalizeEmail_(access.email)) throw new Error('DRILL_SUP_DENIED:' + supEmail);
    const root = ctx.root;
    if (!hubCode) return { path:{saomEmail:'',aomEmail:'',supEmail:access.email,hubCode:''}, view:nodeToView_(root) };
    const hub = (root.hubs || []).find(function(x) { return normalizeCompare_(x.value) === normalizeCompare_(hubCode); });
    if (!hub) throw new Error('DRILL_HUB_DENIED:' + hubCode);
    return { path:{saomEmail:'',aomEmail:'',supEmail:access.email,hubCode:hub.value}, view:nodeToView_(hub) };
  }

  const hubs = ctx.hubs || [];
  if (!hubCode && hubs.length > 1) {
    return { path:{saomEmail:'',aomEmail:'',supEmail:'',hubCode:''}, view:nodeToView_(ctx.root) };
  }

  const selected = hubCode
    ? hubs.find(function(x) { return normalizeCompare_(x.value) === normalizeCompare_(hubCode); })
    : hubs[0];
  if (!selected) throw new Error('DRILL_HUB_DENIED:' + hubCode);
  return { path:{saomEmail:'',aomEmail:'',supEmail:'',hubCode:selected.value}, view:nodeToView_(selected) };
}

function resolveDrillView(path) {
  const access = requireAccess_();
  const resolved = assertDrillPathAccess_(access, path || {});
  return {
    ok:true,
    user:toPublicUser_(access),
    access:toPublicAccess_(access),
    path:resolved.path,
    view:resolved.view,
    serverTime:new Date().toISOString()
  };
}

/* ============================================================
   RANK + SCOPE ENGINE
   ============================================================ */

/**
 * Visible scope logic requested:
 *
 * ADMIN -> CITY, SAOM, AOM, SUP, HUB
 * SAOM  -> SAOM, AOM, SUP, HUB
 * AOM   -> AOM, SUP, HUB
 * SUP   -> HUB only
 * HUB   -> HUB only
 */
function allowedLevelsForRank_(rank) {
  switch (normalizeRank_(rank)) {
    case 'ADMIN': return ['CITY','SAOM','AOM','SUP','HUB'];
    case 'SAOM': return ['SAOM','AOM','SUP','HUB'];
    case 'AOM': return ['AOM','SUP','HUB'];
    case 'SUP': return ['SUP','HUB'];
    case 'HUB':
    default: return ['HUB'];
  }
}

function buildScopeContext_(access, permissionModel) {
  const rank = normalizeRank_(access.rank);
  const levels = allowedLevelsForRank_(rank);
  const model = permissionModel || getPermissionModel_(false);
  const users = model.users || {};
  const stations = model.stations || [];
  const options = { CITY:[], SAOM:[], AOM:[], SUP:[], HUB:[] };

  if (rank === 'ADMIN') {
    options.CITY = [{ value:APP.CITY_VALUE, label:APP.CITY_LABEL, hubCount:stations.length }];
    options.SAOM = permissionUsersByRank_(model, 'SAOM').map(function(u) { return permissionUserScopeOption_(u, 'SAOM'); });
    options.AOM = permissionUsersByRank_(model, 'AOM').map(function(u) { return permissionUserScopeOption_(u, 'AOM'); });
    options.SUP = permissionUsersByRank_(model, 'SUP').map(function(u) { return permissionUserScopeOption_(u, 'SUP'); });
    options.HUB = stations.map(function(s) { return { value:s.hubCode, label:s.hubName, hubCount:1 }; });
  }

  if (rank === 'SAOM') {
    options.SAOM = [{ value:access.email, label:'SAOM • ' + (access.displayName || permissionDisplayNameForEmail_(access.email, model)), hubCount:(access.hubCodes || []).length }];
    const allowed = makeHubSet_(access.hubCodes || []);
    const aoms = {}, sups = {};
    stations.forEach(function(s) {
      if (!allowed[normalizeCompare_(s.hubCode)]) return;
      (s.aom || []).forEach(function(email) { email=normalizeEmail_(email); if(email) aoms[email]=true; });
      (s.sup || []).forEach(function(email) { email=normalizeEmail_(email); if(email) sups[email]=true; });
    });
    options.AOM = Object.keys(aoms).map(function(email) {
      const u=users[email]; if(!u || u.rank!=='AOM') return null;
      const o=permissionUserScopeOption_(u,'AOM'); o.hubCount=intersectHubCodes_(u.hubCodes||[],access.hubCodes||[]).length; return o;
    }).filter(Boolean).filter(function(o){return o.hubCount>0;});
    options.SUP = Object.keys(sups).map(function(email) {
      const u=users[email]; if(!u || u.rank!=='SUP') return null;
      const o=permissionUserScopeOption_(u,'SUP'); o.hubCount=intersectHubCodes_(u.hubCodes||[],access.hubCodes||[]).length; return o;
    }).filter(Boolean).filter(function(o){return o.hubCount>0;});
    options.HUB = (access.stations || []).map(function(s){return {value:s.hubCode,label:s.hubName,hubCount:1};});
  }

  if (rank === 'AOM') {
    options.AOM = [{ value:access.email, label:'AOM • ' + (access.displayName || permissionDisplayNameForEmail_(access.email, model)), hubCount:(access.hubCodes || []).length }];
    const allowed = makeHubSet_(access.hubCodes || []);
    const childSupEmails = {};
    stations.forEach(function(s) {
      if (!allowed[normalizeCompare_(s.hubCode)]) return;
      (s.sup || []).forEach(function(email) { email=normalizeEmail_(email); if(email) childSupEmails[email]=true; });
    });
    options.SUP = Object.keys(childSupEmails)
      .filter(function(email){return users[email] && users[email].rank==='SUP';})
      .map(function(email){const o=permissionUserScopeOption_(users[email],'SUP');o.hubCount=intersectHubCodes_(users[email].hubCodes||[],access.hubCodes||[]).length;return o;})
      .filter(function(o){return o.hubCount>0;});
    options.HUB = (access.stations || []).map(function(s){return {value:s.hubCode,label:s.hubName,hubCount:1};});
  }

  if (rank === 'SUP') {
    options.SUP = [{ value:access.email, label:'SUP • ' + (access.displayName || permissionDisplayNameForEmail_(access.email, model)), hubCount:(access.hubCodes || []).length }];
    options.HUB = (access.stations || []).map(function(s){return {value:s.hubCode,label:s.hubName,hubCount:1};});
  }

  if (rank === 'HUB') {
    options.HUB = (access.stations || []).map(function(s){return {value:s.hubCode,label:s.hubName,hubCount:1};});
  }

  Object.keys(options).forEach(function(type){ options[type]=uniqueScopeOptions_(options[type]); });
  const enabled = {};
  Object.keys(options).forEach(function(type){ enabled[type]=levels.indexOf(type)!==-1 && options[type].length>0; });

  return {
    rank:rank,
    allowedLevels:levels,
    enabled:enabled,
    options:options,
    defaultScope:chooseDefaultScope_(rank, options),
    cityLabel:APP.CITY_LABEL,
    stationCount:stations.length,
    permissionUserCount:Object.keys(users).length,
    permissionGeneratedAt:model.generatedAt || ''
  };
}

function chooseDefaultScope_(rank, options) {
  if (rank === 'ADMIN' && options.CITY.length) {
    return copyScopeOption_('CITY', options.CITY[0]);
  }
  if (rank === 'SAOM' && options.SAOM.length) {
    return copyScopeOption_('SAOM', options.SAOM[0]);
  }
  if (rank === 'AOM' && options.AOM.length) {
    return copyScopeOption_('AOM', options.AOM[0]);
  }
  if (rank === 'SUP' && options.SUP.length) {
    return copyScopeOption_('SUP', options.SUP[0]);
  }
  if (rank === 'HUB' && options.HUB.length) {
    return copyScopeOption_('HUB', options.HUB[0]);
  }
  return { type:'HUB', value:'', label:'No assigned Hub', hubCount:0 };
}

function copyScopeOption_(type, option) {
  return {
    type: type,
    value: option.value,
    label: option.label,
    hubCount: Number(option.hubCount || (type === 'HUB' ? 1 : 0))
  };
}

function makeHubSet_(hubCodes) {
  const out = {};
  (hubCodes || []).forEach(function(code) {
    out[normalizeCompare_(code)] = true;
  });
  return out;
}

function intersectHubCodes_(a, b) {
  const allowed = makeHubSet_(b || []);
  return (a || []).filter(function(code) {
    return allowed[normalizeCompare_(code)];
  });
}

function assertScopeAccess_(access, scopeType, scopeValue) {
  if(String(scopeType||'').toUpperCase()==='HUB_GROUP'){
    if(access.rank!=='HUB'||String(scopeValue)!=='MY_HUBS')throw Error('SCOPE_DENIED:HUB_GROUP');
    const allowed=filterStationsByHubCodes_((getPermissionModel_(false).stations||[]),access.hubCodes||[]).map(s=>s.hubCode);
    if(!allowed.length)throw Error('SCOPE_DENIED:HUB_GROUP');
    return {type:'HUB_GROUP',value:'MY_HUBS',label:'Assigned HUBs',hubCodes:allowed,hubCount:allowed.length};
  }
  const type = normalizeOrgType_(scopeType);
  const value = type === 'CITY' ? APP.CITY_VALUE : cleanText_(scopeValue, 500);
  const context = buildScopeContext_(access);

  if (!context.enabled[type]) {
    throw new Error('SCOPE_DENIED:' + type);
  }

  const hit = (context.options[type] || []).find(function(option) {
    return normalizeCompare_(option.value) === normalizeCompare_(value);
  });

  if (!hit) {
    throw new Error('SCOPE_VALUE_DENIED:' + type + ':' + value);
  }

  const model = getPermissionModel_(false);
  let hubCodes = [];

  if (type === 'CITY') {
    hubCodes = (model.stations || []).map(function(s) { return s.hubCode; });
  } else if (type === 'HUB') {
    hubCodes = [hit.value];
  } else if (type === 'SAOM' || type === 'AOM' || type === 'SUP') {
    const u = (model.users || {})[normalizeEmail_(hit.value)];
    hubCodes = u ? (u.hubCodes || []).slice() : [];

    if ((access.rank === 'SAOM' && (type === 'AOM' || type === 'SUP')) || (access.rank === 'AOM' && type === 'SUP')) {
      hubCodes = intersectHubCodes_(hubCodes, access.hubCodes || []);
    }
  }

  if (access.rank !== 'ADMIN') {
    hubCodes = intersectHubCodes_(hubCodes, access.hubCodes || []);
  }

  return {
    type: type,
    value: hit.value,
    label: hit.label,
    hubCodes: hubCodes,
    hubCount: hubCodes.length
  };
}

function resolveDataView(viewType, viewValue) {
  const access = requireAccess_();
  const view = assertScopeAccess_(access, viewType, viewValue);
  return {
    ok: true,
    user: toPublicUser_(access),
    access: toPublicAccess_(access),
    view: view,
    serverTime: new Date().toISOString()
  };
}


function toScopeOption_(node) {
  return {
    value: node.value,
    label:
      node.displayName ||
      node.value
  };
}

function uniqueScopeOptions_(options) {
  const seen = {};
  const out = [];

  options.forEach(option => {
    const key =
      normalizeCompare_(
        option.value
      );

    if (!key || seen[key]) return;

    seen[key] = true;
    out.push(option);
  });

  return out.sort(
    (a, b) =>
      String(a.label)
        .localeCompare(
          String(b.label)
        )
  );
}

function parseScopeValues_(value) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeRank_(value) {
  const v = String(value || 'HUB')
    .trim()
    .toUpperCase();

  if (v === 'CITY' || v === 'ALL') {
    return 'ADMIN';
  }

  if (
    ['ADMIN', 'NORMAL', 'SAOM', 'AOM', 'SUP', 'HUB']
      .includes(v)
  ) {
    return v;
  }

  return 'HUB';
}

function normalizeOrgType_(value) {
  const v = String(value || 'HUB')
    .trim()
    .toUpperCase();

  if (
    v === 'ALL' ||
    v === 'CITY' ||
    v === 'HCM CITY' ||
    v === 'HCM_CITY'
  ) {
    return 'CITY';
  }

  if (
    ['SAOM', 'AOM', 'SUP', 'HUB']
      .includes(v)
  ) {
    return v;
  }

  return 'HUB';
}

function normalizeCompare_(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


/* ============================================================
   ADMIN DIAGNOSTICS — VERIFY DATABASE BINDING
   ============================================================ */

function debugDatabaseBinding() {
  const configuredId = String(
    PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID') || ''
  ).trim();

  if (!configuredId) {
    return {
      ok:false,
      version:APP.VERSION,
      configuredId:'',
      message:'APP_DB_SHEET_ID is not configured.'
    };
  }

  const ss = SpreadsheetApp.openById(configuredId);
  const userSheet = ss.getSheetByName(APP.USER_SHEET);
  const permissionSheet = findPermissionSheet_(ss);

  return {
    ok:true,
    version:APP.VERSION,
    configuredId:configuredId,
    spreadsheetId:ss.getId(),
    spreadsheetName:ss.getName(),
    spreadsheetUrl:ss.getUrl(),
    hasAdhocUser:Boolean(userSheet),
    permissionSheet:permissionSheet ? permissionSheet.getName() : '',
    orgScopeUsed:false,
    note:'Adhoc ADMIN overrides Permission. Permission ranks: SAOM > AOM > SUP > HUB.'
  };
}

function getAdminDatabaseDiagnostics() {
  const admin = requireAdmin_();
  const ss = getDb_();
  const sheet = ss.getSheetByName(APP.USER_SHEET);
  const permissionSheet = findPermissionSheet_(ss);

  let physicalEmailRows = 0;
  let physicalAdminRows = 0;
  let physicalActiveAdmins = 0;
  let physicalDeletedAdmins = 0;

  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, APP.USER_HEADERS.length)
      .getValues();

    values.forEach(function(r) {
      const email = normalizeEmail_(r[0]);
      if (!email) return;
      physicalEmailRows++;

      const role = String(r[2] || '').trim().toUpperCase();
      if (role !== 'ADMIN') return;
      physicalAdminRows++;

      const source = String(r[6] || '').trim().toUpperCase();
      if (source === 'ADHOC_DELETED') physicalDeletedAdmins++;
      else if (toBool_(r[5])) physicalActiveAdmins++;
    });
  }

  return {
    ok:true,
    checkedBy:admin.email,
    version:APP.VERSION,
    spreadsheetId:ss.getId(),
    spreadsheetName:ss.getName(),
    spreadsheetUrl:ss.getUrl(),
    configuredId:PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID') || '',
    adhocSheet:APP.USER_SHEET,
    permissionSheet:permissionSheet ? permissionSheet.getName() : '',
    orgScopeUsed:false,
    physicalEmailRows:physicalEmailRows,
    physicalAdminRows:physicalAdminRows,
    physicalActiveAdmins:physicalActiveAdmins,
    physicalDeletedAdmins:physicalDeletedAdmins,
    superAdmins:SUPER_ADMIN_EMAILS.slice(),
    checkedAt:new Date().toISOString()
  };
}


/* ============================================================
   SUPER ADMIN + ADHOC AUDIT
   ============================================================ */

function isSuperAdminEmail_(email) {
  email = normalizeEmail_(email);
  return SUPER_ADMIN_EMAILS.some(function(item) { return normalizeEmail_(item) === email; });
}

function ensureSuperAdminsRecorded_() {
  const sheet = getRequiredSheet_(APP.USER_SHEET);
  const now = new Date();

  SUPER_ADMIN_EMAILS.forEach(function(rawEmail) {
    const email = normalizeEmail_(rawEmail);
    const found = findUserRowByEmailDirect_(email);

    const rowValues = [[
      email,
      found && found.values[1] ? found.values[1] : displayNameFromEmail_(email),
      'ADMIN',
      'CITY',
      APP.CITY_VALUE,
      true,
      'SUPER_ADMIN',
      found && found.values[7] ? found.values[7] : 'Protected Super Admin',
      found && found.values[8] ? found.values[8] : now,
      now
    ]];

    if (found) {
      const needsRepair =
        String(found.values[2] || '').toUpperCase() !== 'ADMIN' ||
        normalizeOrgType_(found.values[3]) !== 'CITY' ||
        String(found.values[4] || '') !== APP.CITY_VALUE ||
        !toBool_(found.values[5]) ||
        String(found.values[6] || '') !== 'SUPER_ADMIN';

      if (needsRepair) {
        sheet.getRange(found.row, 1, 1, APP.USER_HEADERS.length).setValues(rowValues);
      }
    } else {
      const targetRow = findFirstEmptyAdhocEmailRow_(sheet);
      sheet.getRange(targetRow, 1, 1, APP.USER_HEADERS.length).setValues(rowValues);
    }
  });

  SpreadsheetApp.flush();
}

function upsertAdminRecord_(email, opts) {
  opts = opts || {};

  email =
    normalizeEmail_(email);

  const sheet =
    getRequiredSheet_(APP.USER_SHEET);

  const found =
    findUserRowByEmailDirect_(email);

  const now =
    new Date();

  const createdAt =
    found &&
    opts.preserveCreatedAt !== false
      ? (
          found.values[8] ||
          now
        )
      : now;

  let role =
    String(
      opts.role ||
      (
        found
          ? found.values[2]
          : 'NORMAL'
      ) ||
      'NORMAL'
    )
      .trim()
      .toUpperCase();

  if (
    role !== 'ADMIN' &&
    role !== 'NORMAL'
  ) {
    role = 'NORMAL';
  }

  if (
    isSuperAdminEmail_(email)
  ) {
    role = 'ADMIN';
  }

  const isAdminRole =
    role === 'ADMIN';

  const row = [[
    email,

    cleanText_(
      opts.displayName ||
      (
        found &&
        found.values[1]
      ) ||
      displayNameFromEmail_(email),
      120
    ),

    role,

    isAdminRole
      ? 'CITY'
      : 'MODULES',

    isAdminRole
      ? APP.CITY_VALUE
      : '',

    isSuperAdminEmail_(email)
      ? true
      : opts.active !== false,

    isSuperAdminEmail_(email)
      ? 'SUPER_ADMIN'
      : cleanText_(
          opts.source ||
          'ACCOUNT_UPDATED',
          100
        ),

    cleanText_(
      opts.note != null
        ? opts.note
        : (
            found
              ? found.values[7]
              : ''
          ),
      500
    ),

    createdAt,
    now
  ]];

  const targetRow =
    found
      ? found.row
      : findFirstEmptyAdhocEmailRow_(
          sheet
        );

  sheet
    .getRange(
      targetRow,
      1,
      1,
      APP.USER_HEADERS.length
    )
    .setValues(row);

  SpreadsheetApp.flush();

  return {
    email:email,
    role:role,
    row:targetRow,
    createdAt:toIso_(createdAt),
    updatedAt:now.toISOString()
  };
}

function configureDatabase_(spreadsheetId) {
  spreadsheetId = String(spreadsheetId || '').trim();
  if (!spreadsheetId) throw new Error('Thiếu Spreadsheet ID.');

  const ss = SpreadsheetApp.openById(spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('APP_DB_SHEET_ID', ss.getId());
  __SPX_DB_MEMO = ss; __SPX_DB_MEMO_ID = ss.getId();

  const userSheet = ensureSheet_(ss, APP.USER_SHEET, APP.USER_HEADERS);
  formatUserSheet_(userSheet);
  ensureTargetProdSheets_();
  ensureRuntimeStatusSheet_();
  compactAdhocUserRows_();
  ensureSuperAdminsRecorded_();
  clearPermissionCache_(true);
  clearSecurityCaches_();

  return getDatabaseInfo();
}


function bindDatabaseToActiveSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Không có active spreadsheet. Hãy dùng setupAppsScript().');
  }

  PropertiesService.getScriptProperties().setProperty('APP_DB_SHEET_ID', active.getId());
  __SPX_DB_MEMO = active; __SPX_DB_MEMO_ID = active.getId();
  const userSheet = ensureSheet_(active, APP.USER_SHEET, APP.USER_HEADERS);
  formatUserSheet_(userSheet);
  ensureTargetProdSheets_();
  ensureRuntimeStatusSheet_();
  compactAdhocUserRows_();
  ensureSuperAdminsRecorded_();
  clearPermissionCache_(true);
  clearSecurityCaches_();

  return getDatabaseInfo();
}


function getDatabaseInfo() {
  const ss = getDb_();
  const userSheet = ss.getSheetByName(APP.USER_SHEET);
  const permissionSheet = findPermissionSheet_(ss);
  let physicalEmailRows = 0;

  if (userSheet && userSheet.getLastRow() >= 2) {
    physicalEmailRows = userSheet
      .getRange(2, 1, userSheet.getLastRow() - 1, 1)
      .getValues()
      .filter(function(r) { return normalizeEmail_(r[0]); })
      .length;
  }

  return {
    spreadsheetId:ss.getId(),
    spreadsheetName:ss.getName(),
    spreadsheetUrl:ss.getUrl(),
    configuredId:PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID') || '',
    adhocSheet:APP.USER_SHEET,
    adhocRows:physicalEmailRows,
    permissionSheet:permissionSheet ? permissionSheet.getName() : '',
    orgScopeUsed:false,
    superAdmins:SUPER_ADMIN_EMAILS.slice()
  };
}


/* ============================================================
   SHEET READERS
   ============================================================ */

function getDb_() {
  const configuredId = String(
    PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID') || ''
  ).trim();

  if (!configuredId) {
    throw new Error(
      'DB_NOT_CONFIGURED: APP_DB_SHEET_ID chưa được cấu hình. ' +
      'Chạy setupAppsScript() trong editor.'
    );
  }

  if (__SPX_DB_MEMO && __SPX_DB_MEMO_ID === configuredId) return __SPX_DB_MEMO;

  try {
    __SPX_DB_MEMO = SpreadsheetApp.openById(configuredId);
    __SPX_DB_MEMO_ID = configuredId;
    return __SPX_DB_MEMO;
  } catch (err) {
    __SPX_DB_MEMO = null;
    __SPX_DB_MEMO_ID = '';
    throw new Error(
      'DB_OPEN_FAILED: Không mở được database đã cấu hình (' + configuredId + '). ' +
      (err && err.message ? err.message : err)
    );
  }
}



function ensureSheet_(
  ss,
  name,
  headers
) {
  let sheet =
    ss.getSheetByName(name);

  if (!sheet) {
    sheet =
      ss.insertSheet(name);
  }

  headers.forEach((header, i) => {
    if (
      String(
        sheet
          .getRange(1, i + 1)
          .getValue() || ''
      ).trim() !== header
    ) {
      sheet
        .getRange(1, i + 1)
        .setValue(header);
    }
  });

  sheet.setFrozenRows(1);

  return sheet;
}

function getRequiredSheet_(name) {
  const sheet =
    getDb_()
      .getSheetByName(name);

  if (!sheet) {
    throw new Error(
      `Missing sheet "${name}". Run setupApp() once.`
    );
  }

  return sheet;
}

function findUserRowByEmailDirect_(email) {
  email = normalizeEmail_(email);
  if (!email) return null;

  const sheet = getRequiredSheet_(APP.USER_SHEET);
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return null;

  // EMAIL column is the only row-presence key for Adhoc user.
  // Do not rely on getLastRow(), because legacy checkboxes may leave FALSE
  // values far below the real data rows.
  const emails = sheet
    .getRange(2, 1, maxRows - 1, 1)
    .getDisplayValues();

  for (let i = 0; i < emails.length; i++) {
    if (normalizeEmail_(emails[i][0]) === email) {
      const rowNumber = i + 2;
      const values = sheet
        .getRange(rowNumber, 1, 1, APP.USER_HEADERS.length)
        .getValues()[0];
      return { row: rowNumber, values: values };
    }
  }

  return null;
}



function findFirstEmptyAdhocEmailRow_(sheet) {
  const maxRows = sheet.getMaxRows();

  if (maxRows < 2) {
    sheet.insertRowsAfter(1, 1);
    return 2;
  }

  const emails = sheet
    .getRange(2, 1, maxRows - 1, 1)
    .getDisplayValues();

  for (let i = 0; i < emails.length; i++) {
    if (!normalizeEmail_(emails[i][0])) {
      return i + 2;
    }
  }

  sheet.insertRowsAfter(maxRows, 1);
  return maxRows + 1;
}


function cleanLegacyBlankAdhocRows_(sheet) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return;

  const rowCount = maxRows - 1;
  const emails = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
  const activeRange = sheet.getRange(2, 6, rowCount, 1);
  const activeValues = activeRange.getValues();

  let changed = false;

  for (let i = 0; i < rowCount; i++) {
    if (!normalizeEmail_(emails[i][0]) && activeValues[i][0] !== '') {
      activeValues[i][0] = '';
      changed = true;
    }
  }

  activeRange.clearDataValidations();
  if (changed) activeRange.setValues(activeValues);
}


function compactAdhocUserRows_() {
  const sheet = getRequiredSheet_(APP.USER_SHEET);
  const maxRows = sheet.getMaxRows();
  if (maxRows < 2) return { moved: 0, records: 0 };

  const rowCount = maxRows - 1;
  const allRows = sheet
    .getRange(2, 1, rowCount, APP.USER_HEADERS.length)
    .getValues();

  const records = allRows.filter(function(row) {
    return normalizeEmail_(row[0]);
  });

  // Clear only the app-owned 10 columns, preserving the header row.
  sheet.getRange(2, 1, rowCount, APP.USER_HEADERS.length).clearContent();
  sheet.getRange(2, 6, rowCount, 1).clearDataValidations();

  if (records.length) {
    sheet
      .getRange(2, 1, records.length, APP.USER_HEADERS.length)
      .setValues(records);
  }

  SpreadsheetApp.flush();

  return {
    moved: records.length,
    records: records.length,
    firstDataRow: records.length ? 2 : null,
    lastDataRow: records.length ? records.length + 1 : null
  };
}


function repairAdhocUserStorage() {
  const access = requireAdmin_();

  return withShortWriteLock_(function() {
    const sheet = getRequiredSheet_(APP.USER_SHEET);
    cleanLegacyBlankAdhocRows_(sheet);
    const compact = compactAdhocUserRows_();
    ensureSuperAdminsRecorded_();

    return {
      ok: true,
      repairedBy: access.email,
      spreadsheetId: getDb_().getId(),
      spreadsheetName: getDb_().getName(),
      sheetName: APP.USER_SHEET,
      records: readAdhocAdminsDirect_(true).length,
      compact: compact,
      repairedAt: new Date().toISOString()
    };
  });
}


function clearSecurityCaches_() {
  // Adhoc ADMIN writes must not throw away the large Permission model.
  // Version bump invalidates access grants; admin index is rebuilt lazily.
  bumpSecurityVersion_();
  clearAdminIndexCache_();
}



function withShortWriteLock_(fn) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(CACHE_CFG.WRITE_LOCK_MS)) {
    throw new Error(
      'WRITE_BUSY: hệ thống đang có một thay đổi quyền khác. Vui lòng thử lại sau vài giây.'
    );
  }

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


function rowToUserObject_(r) {
  let role =
    String(r[2] || 'NORMAL')
      .trim()
      .toUpperCase();

  if (
    role !== 'ADMIN' &&
    role !== 'NORMAL'
  ) {
    role = 'NORMAL';
  }

  if (
    isSuperAdminEmail_(r[0])
  ) {
    role = 'ADMIN';
  }

  const rank =
    role === 'ADMIN'
      ? 'ADMIN'
      : 'NORMAL';

  return {
    email:
      normalizeEmail_(r[0]),

    displayName:
      String(r[1] || ''),

    role:
      role,

    rank:
      rank,

    scopeType:
      rank === 'ADMIN'
        ? 'CITY'
        : 'MODULES',

    scopeValue:
      rank === 'ADMIN'
        ? APP.CITY_VALUE
        : '',

    active:
      isSuperAdminEmail_(r[0])
        ? true
        : toBool_(r[5]),

    isSuperAdmin:
      isSuperAdminEmail_(r[0]),

    status:
      isSuperAdminEmail_(r[0])
        ? 'PROTECTED'
        : (
            String(r[6] || '')
              .toUpperCase() === 'ADHOC_DELETED'
              ? 'DELETED'
              : (
                  toBool_(r[5])
                    ? 'ACTIVE'
                    : 'INACTIVE'
                )
          ),

    source:
      String(r[6] || ''),

    note:
      String(r[7] || ''),

    createdAt:
      toIso_(r[8]),

    updatedAt:
      toIso_(r[9])
  };
}


/* ============================================================
   SHEET FORMAT — SETUP ONLY
   Never called on normal page reads.
   ============================================================ */

function formatUserSheet_(sheet) {
  sheet.getRange(1, 1, 1, APP.USER_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#ee4d2d')
    .setFontColor('#ffffff');

  [240, 180, 90, 110, 280, 80, 110, 260, 155, 155]
    .forEach(function(width, i) {
      sheet.setColumnWidth(i + 1, width);
    });

  sheet.setFrozenRows(1);

  // Remove legacy checkbox validation AND legacy FALSE values from rows
  // where EMAIL is empty. Those FALSE values were the root cause of
  // appendRow() writing new ADMIN records around row 1002 instead of row 2.
  cleanLegacyBlankAdhocRows_(sheet);
}



/* ============================================================
   V0.12 FAST RUNTIME BACKEND
   ============================================================ */

function persistentPropBase_(name) {
  return RUNTIME_CFG.PERSIST_PREFIX + ':' + String(name || '');
}

function putPersistentJson_(name, value) {
  try {
    const props = PropertiesService.getScriptProperties();
    const base = persistentPropBase_(name);
    const json = JSON.stringify(value);
    const blob = Utilities.newBlob(json, 'application/json');
    const compressed = Utilities.gzip(blob).getBytes();
    const encoded = Utilities.base64Encode(compressed);
    const size = RUNTIME_CFG.PERSIST_CHUNK_CHARS;
    const chunks = [];
    for (let i = 0; i < encoded.length; i += size) chunks.push(encoded.substring(i, i + size));

    const oldMetaRaw = props.getProperty(base + ':meta');
    let oldCount = 0;
    try { oldCount = oldMetaRaw ? Number(JSON.parse(oldMetaRaw).chunks || 0) : 0; } catch (_) {}

    const payload = {};
    chunks.forEach(function(chunk, i) { payload[base + ':c:' + i] = chunk; });
    payload[base + ':meta'] = JSON.stringify({ chunks:chunks.length, updatedAt:new Date().toISOString() });
    props.setProperties(payload, false);

    if (oldCount > chunks.length) {
      const stale = [];
      for (let i = chunks.length; i < oldCount; i++) stale.push(base + ':c:' + i);
      stale.forEach(function(k){ try { props.deleteProperty(k); } catch (_) {} });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function getPersistentJson_(name) {
  try {
    const props = PropertiesService.getScriptProperties();
    const base = persistentPropBase_(name);
    const metaRaw = props.getProperty(base + ':meta');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    const count = Number(meta.chunks || 0);
    if (!count) return null;
    let encoded = '';
    for (let i = 0; i < count; i++) {
      const part = props.getProperty(base + ':c:' + i);
      if (part == null) return null;
      encoded += part;
    }
    const bytes = Utilities.base64Decode(encoded);
    const json = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString('UTF-8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function removePersistentJson_(name) {
  try {
    const props = PropertiesService.getScriptProperties();
    const base = persistentPropBase_(name);
    const metaRaw = props.getProperty(base + ':meta');
    let count = 0;
    try { count = metaRaw ? Number(JSON.parse(metaRaw).chunks || 0) : 0; } catch (_) {}
    props.deleteProperty(base + ':meta');
    for (let i = 0; i < count; i++) props.deleteProperty(base + ':c:' + i);
  } catch (_) {}
}

function getSecurityVersion_() {
  const props = PropertiesService.getScriptProperties();
  let v = Number(props.getProperty(RUNTIME_CFG.SECURITY_VERSION_PROP) || 1);
  if (!isFinite(v) || v < 1) v = 1;
  return String(Math.floor(v));
}

function bumpSecurityVersion_() {
  const props = PropertiesService.getScriptProperties();
  const next = Number(getSecurityVersion_()) + 1;
  props.setProperty(RUNTIME_CFG.SECURITY_VERSION_PROP, String(next));
  return next;
}

function buildAdhocAdminIndex_() {
  const sheet =
    getRequiredSheet_(
      APP.USER_SHEET
    );

  const maxRows =
    sheet.getMaxRows();

  const out = {};

  if (maxRows < 2) {
    return out;
  }

  const rows =
    sheet
      .getRange(
        2,
        1,
        maxRows - 1,
        APP.USER_HEADERS.length
      )
      .getValues();

  rows.forEach(function(r) {
    const email =
      normalizeEmail_(r[0]);

    if (!email) {
      return;
    }

    let role =
      String(
        r[2] ||
        'NORMAL'
      )
        .trim()
        .toUpperCase();

    if (
      role !== 'ADMIN' &&
      role !== 'NORMAL'
    ) {
      return;
    }

    if (
      isSuperAdminEmail_(email)
    ) {
      role = 'ADMIN';
    }

    out[email] = {
      email:email,

      displayName:
        String(
          r[1] ||
          displayNameFromEmail_(email)
        ),

      role:role,

      rank:role,

      active:
        isSuperAdminEmail_(email)
          ? true
          : toBool_(r[5]),

      source:
        isSuperAdminEmail_(email)
          ? 'SUPER_ADMIN'
          : String(
              r[6] ||
              'ACCOUNT'
            )
    };
  });

  return out;
}

function getAdhocAdminIndex_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (forceRefresh === true) {
    try { cache.remove(CACHE_CFG.ADMIN_INDEX_KEY); } catch (_) {}
    removePersistentJson_(RUNTIME_CFG.ADMIN_PERSIST_KEY);
  }
  try {
    const raw = cache.get(CACHE_CFG.ADMIN_INDEX_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  const persisted = getPersistentJson_(RUNTIME_CFG.ADMIN_PERSIST_KEY);
  if (persisted && forceRefresh !== true) {
    try { cache.put(CACHE_CFG.ADMIN_INDEX_KEY, JSON.stringify(persisted), CACHE_CFG.ADMIN_INDEX_TTL_SEC); } catch (_) {}
    return persisted;
  }
  const built = buildAdhocAdminIndex_();
  try { cache.put(CACHE_CFG.ADMIN_INDEX_KEY, JSON.stringify(built), CACHE_CFG.ADMIN_INDEX_TTL_SEC); } catch (_) {}
  putPersistentJson_(RUNTIME_CFG.ADMIN_PERSIST_KEY, built);
  return built;
}

function clearAdminIndexCache_() {
  try { CacheService.getScriptCache().remove(CACHE_CFG.ADMIN_INDEX_KEY); } catch (_) {}
  removePersistentJson_(RUNTIME_CFG.ADMIN_PERSIST_KEY);
}

function allowHeavyForceRefresh_(access, namespace, requested) {
  if (requested !== true) return false;
  // ADMIN can always request a real rebuild. Other ranks are throttled to one
  // shared-heavy refresh attempt per user every 2 minutes.
  if (access && normalizeRank_(access.rank) === 'ADMIN') return true;
  try {
    const cache = CacheService.getUserCache();
    const key = 'spx:v141:force:' + String(namespace || 'data');
    if (cache.get(key)) return false;
    cache.put(key, '1', 120);
    return true;
  } catch (_) {
    return false;
  }
}

function dailyKpiMaterializedSheetName_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  return RUNTIME_CFG.DAILY_FACT_PREFIX + period.replace('-', '_');
}

function ensureDailyKpiMaterializedSheet_(period) {
  const ss = getDb_();
  const name = dailyKpiMaterializedSheetName_(period);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

function persistDailyKpiMaterializedPeriod_(model) {
  if (!model || !model.period) return false;
  try {
    const sh = ensureDailyKpiMaterializedSheet_(model.period);
    const headers = [
      'Period','Date','Hub Code','Hub Name',
      '%FM Ontime','%LM Ontime','%Deli Success',
      'Rider Prod','Sorter Prod','%Correct SOP - PU','Total Volume',
      'Generated At'
    ];
    const rows = (model.rows || []).map(function(r) {
      const v = r.values || {};
      return [
        model.period, r.dateKey, r.hubCode, r.hubName,
        v.fmOntime == null ? '' : v.fmOntime,
        v.lmOntime == null ? '' : v.lmOntime,
        v.deliSuccess == null ? '' : v.deliSuccess,
        v.riderProductivity == null ? '' : v.riderProductivity,
        v.sorterProductivity == null ? '' : v.sorterProductivity,
        v.correctSopPu == null ? '' : v.correctSopPu,
        r.totalVolume == null ? '' : r.totalVolume,
        model.generatedAt || new Date().toISOString()
      ];
    });

    sh.clearContents();
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    if (rows.length) {
      sh.getRange(2,2,rows.length,1).setNumberFormat('@');
      rows.forEach(function(r){ r[1] = factDateKey_(r[1]) || String(r[1] || ''); });
      sh.getRange(2,1,rows.length,headers.length).setValues(rows);
    }
    try { sh.setFrozenRows(1); sh.hideSheet(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function readDailyKpiMaterializedPeriod_(period) {
  try {
    const ss = getDb_();
    const sh = ss.getSheetByName(dailyKpiMaterializedSheetName_(period));
    if (!sh || sh.getLastRow() < 2) return null;
    const values = sh.getRange(2,1,sh.getLastRow()-1,12).getValues();
    const rows = [];
    const dates = {};
    values.forEach(function(r) {
      const dateKey = factDateKey_(r[1]);
      const hubCode = String(r[2] || '').trim();
      if (!dateKey || !hubCode) return;
      function num(x) { return typeof x === 'number' && isFinite(x) ? x : (x === '' ? null : Number(x)); }
      rows.push({
        period:String(r[0] || period),
        dateKey:dateKey,
        hubCode:hubCode,
        hubName:String(r[3] || ''),
        values:{
          fmOntime:num(r[4]),
          lmOntime:num(r[5]),
          deliSuccess:num(r[6]),
          riderProductivity:num(r[7]),
          sorterProductivity:num(r[8]),
          correctSopPu:num(r[9])
        },
        totalVolume:num(r[10]),
        duplicateCounts:{}
      });
      dates[dateKey] = true;
    });
    return {
      generatedAt:String(values[0] && values[0][11] || ''),
      materialized:true,
      period:period,
      dates:Object.keys(dates).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_),
      sourceMeta:{ materialized:{ found:true, sheetName:sh.getName(), rows:rows.length } },
      rows:rows
    };
  } catch (_) {
    return null;
  }
}

function ensureRuntimeStatusSheet_() {
  const ss = getDb_();
  let sh = ss.getSheetByName(RUNTIME_CFG.RUNTIME_STATUS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RUNTIME_CFG.RUNTIME_STATUS_SHEET);
    sh.getRange(1,1,1,4).setValues([['Key','Value','Updated At','Version']]);
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

function setRuntimeStatus_(patch) {
  const props = PropertiesService.getScriptProperties();
  let current = {};
  try { current = JSON.parse(props.getProperty(RUNTIME_CFG.RUNTIME_STATUS_PROP) || '{}'); } catch (_) {}
  Object.keys(patch || {}).forEach(function(k){ current[k] = patch[k]; });
  current.version = APP.VERSION;
  current.updatedAt = new Date().toISOString();
  try { props.setProperty(RUNTIME_CFG.RUNTIME_STATUS_PROP, JSON.stringify(current)); } catch (_) {}
  return current;
}

function getRuntimeStatus_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(RUNTIME_CFG.RUNTIME_STATUS_PROP) || '{}');
  } catch (_) { return {}; }
}






/* ============================================================
   HELPERS
   ============================================================ */

function renderAccessPage_(
  title,
  message
) {
  const html = `
  <!doctype html>
  <html>
  <head>
    <meta name="viewport"
          content="width=device-width, initial-scale=1">
    <style>
      body{
        margin:0;
        font-family:Arial,sans-serif;
        background:
          radial-gradient(circle at 10% 0%, rgba(238,77,45,.10), transparent 28%),
          radial-gradient(circle at 90% 100%, rgba(0,83,222,.08), transparent 26%),
          #f5f7fa;
        color:#172033
      }
      .wrap{
        min-height:100vh;
        display:grid;
        place-items:center;
        padding:24px
      }
      .card{
        width:min(560px,100%);
        padding:30px;
        border:1px solid #e3e8ef;
        border-radius:20px;
        background:rgba(255,255,255,.96);
        box-shadow:0 18px 50px rgba(17,51,102,.08)
      }
      .logo{
        width:46px;height:46px;
        display:grid;place-items:center;
        border-radius:14px;
        background:#ee4d2d;color:white;
        font-weight:900;margin-bottom:18px
      }
      h1{margin:0 0 10px;font-size:24px}
      p{line-height:1.65;color:#606b7b}
      code{
        padding:2px 7px;
        border-radius:7px;
        background:#fff0ec;
        color:#d3422a
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="logo">S</div>
        <h1>${escapeHtml_(title)}</h1>
        <p>${escapeHtml_(message)}</p>
        <p>Authorization source:
          <code>${APP.USER_SHEET}</code>
        </p>
      </div>
    </div>
  </body>
  </html>`;

  return HtmlService
    .createHtmlOutput(html)
    .setTitle(APP.NAME);
}

function normalizeEmail_(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(email);
}

function displayNameFromEmail_(email) {
  const prefix =
    normalizeEmail_(email)
      .split('@')[0] ||
    'User';

  return prefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part =>
      part.charAt(0).toUpperCase() +
      part.slice(1)
    )
    .join(' ');
}

function cleanText_(
  value,
  maxLen
) {
  return String(value || '')
    .replace(
      /[\u0000-\u001f]/g,
      ' '
    )
    .trim()
    .slice(
      0,
      maxLen || 500
    );
}

function toBool_(value) {
  if (value === true) {
    return true;
  }

  const s =
    String(value || '')
      .trim()
      .toLowerCase();

  return [
    'true',
    '1',
    'yes',
    'y',
    'active'
  ].includes(s);
}

function toIso_(value) {
  if (!value) return '';

  const d =
    value instanceof Date
      ? value
      : new Date(value);

  return isNaN(d.getTime())
    ? String(value)
    : d.toISOString();
}

function safeJson_(obj) {
  return JSON
    .stringify(obj)
    .replace(
      /</g,
      '\\u003c'
    );
}

function escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============================================================
   DAILY KPI PERFORMANCE + TARGET PROD WORKFLOW — V0.10.1
   ------------------------------------------------------------
   Sources (wide unless noted):
     FM_On_time   -> %FM Ontime
     LM_Ontime    -> %LM Ontime
     SOP          -> %Correct SOP - PU
     DSR          -> %Deli Success
     PROD_RIDER   -> Rider Prod actual
     PROD_SORTER  -> Sorter Prod actual + Total Volume (LONG)

   Official daily scoring carried forward from KPI rulebook:
     Correct SOP-PU 10%
     FM Ontime      20%
     LM Ontime      20%
     Deli Success   15%
     Rider Prod     15%
     Sorter Prod    20%

   Rate KPI score = actual rate (cap 100%).
   Productivity score = actual / monthly HUB target, HARD-CAPPED at 120%
   for BOTH scoring and API/UI display. Raw ratio is retained only for audit.
   Daily raw source data is cached by PERIOD to avoid rebuilding all history.
   Grade is calculated ONLY when all required metrics and prod targets exist.
   ============================================================ */

const DAILY_KPI_CFG = Object.freeze({
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  TARGET_SHEET: 'Target Prod',
  TARGET_SOURCE_SHEET: 'Target Prod KPI',
  TARGET_SOURCE_ALIASES: ['Target Prod KPI'],
  REQUEST_SHEET: 'Target Prod Requests',
  CONFIG_SHEET: 'Tỷ trọng KPI',
  TARGET_HEADERS: [
    'Period',
    'Hub Name',
    'Target năng xuất rider',
    'Target năng xuất sorter',
    'Last Log'
  ],
  REQUEST_HEADERS: [
    'REQUEST_ID','PERIOD','HUB_NAME','HUB_CODE',
    'OLD_RIDER_TARGET','NEW_RIDER_TARGET',
    'OLD_SORTER_TARGET','NEW_SORTER_TARGET',
    'REQUESTED_BY','REQUESTED_AT','STATUS',
    'REVIEWED_BY','REVIEWED_AT','REVIEW_NOTE'
  ],
  CONFIG_HEADERS: [
    'CONFIG_ID','CONFIG_TYPE','PERIOD','HUB_TYPE','KPI_KEY',
    'WEIGHT_PCT','GRADE','MIN_POINT_PCT','MAX_POINT_PCT',
    'VERSION','ACTIVE','CREATED_BY','CREATED_AT','LAST_LOG'
  ],
  SOURCES: Object.freeze({
    fmOntime: {
      label:'%FM Ontime', type:'RATE', layout:'WIDE',
      sheets:['FM_On_time','FM On time','FM Ontime','Daily FM Ontime'],
      scoreCap:1.00
    },
    lmOntime: {
      label:'%LM Ontime', type:'RATE', layout:'WIDE',
      sheets:['LM_Ontime','LM On time','LM Ontime','Daily LM Ontime'],
      scoreCap:1.00
    },
    correctSopPu: {
      label:'%Correct SOP - PU', type:'RATE', layout:'WIDE',
      sheets:['SOP','Correct SOP','Daily Correct SOP-PU','Daily Correct SOP - PU'],
      scoreCap:1.00
    },
    deliSuccess: {
      label:'%Deli Success', type:'RATE', layout:'WIDE',
      sheets:['DSR','Deli Success','Daily Deli Success','Daily Deli Successs'],
      scoreCap:1.00
    },
    riderProductivity: {
      label:'%Rider Productivity', type:'NUMBER', layout:'WIDE',
      sheets:['PROD_RIDER','PROD RIDER','Daily Rider Prod','Daily Rider Productivity'],
      scoreCap:1.20
    },
    sorterProductivity: {
      label:'%Sorter Productivity', type:'NUMBER', layout:'LONG_SORTER',
      sheets:['PROD_SORTER','PROD SORTER','Daily Sorter Prod','Daily Sorter Productivity'],
      scoreCap:1.20
    }
  }),
  KPI_KEYS: Object.freeze([
    'fmOntime','lmOntime','sorterProductivity',
    'deliSuccess','riderProductivity','correctSopPu'
  ]),
  DEFAULT_WEIGHTS: Object.freeze({
    AMH: Object.freeze({
      fmOntime:20,
      lmOntime:20,
      sorterProductivity:20,
      deliSuccess:15,
      riderProductivity:15,
      correctSopPu:10
    }),
    FM: Object.freeze({
      fmOntime:40,
      lmOntime:0,
      sorterProductivity:40,
      deliSuccess:0,
      riderProductivity:0,
      correctSopPu:20
    }),
    LM: Object.freeze({
      fmOntime:0,
      lmOntime:30,
      sorterProductivity:30,
      deliSuccess:20,
      riderProductivity:20,
      correctSopPu:0
    })
  }),
  DEFAULT_GRADE_RULES: Object.freeze([
    Object.freeze({ grade:'A+', minPointPct:106.21, maxPointPct:107.00 }),
    Object.freeze({ grade:'A',  minPointPct:103.55, maxPointPct:106.20 }),
    Object.freeze({ grade:'A-', minPointPct:101.77, maxPointPct:103.54 }),
    Object.freeze({ grade:'B+', minPointPct:100.81, maxPointPct:101.76 }),
    Object.freeze({ grade:'B',  minPointPct:95.39,  maxPointPct:100.80 }),
    Object.freeze({ grade:'C',  minPointPct:0.00,   maxPointPct:95.38 })
  ])
});

function ensureTargetProdSheets_() {
  const ss = getDb_();
  const target = ensureSheet_(ss, DAILY_KPI_CFG.TARGET_SHEET, DAILY_KPI_CFG.TARGET_HEADERS);
  const request = ensureSheet_(ss, DAILY_KPI_CFG.REQUEST_SHEET, DAILY_KPI_CFG.REQUEST_HEADERS);
  const config = ensureSheet_(ss, DAILY_KPI_CFG.CONFIG_SHEET, DAILY_KPI_CFG.CONFIG_HEADERS);
  try {
    target.setFrozenRows(1);
    request.setFrozenRows(1);
    config.setFrozenRows(1);
  } catch (_) {}
  return {
    targetSheet:target.getName(),
    requestSheet:request.getName(),
    configSheet:config.getName()
  };
}

function dailyKpiNormalizePeriod_(value) {
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})[-\/]?(\d{1,2})$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/](\d{4})$/);
  if (m) return m[2] + '-' + ('0' + m[1]).slice(-2);
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, DAILY_KPI_CFG.TIMEZONE, 'yyyy-MM');
  }
  return '';
}

function dailyKpiCurrentPeriod_() {
  return Utilities.formatDate(new Date(), DAILY_KPI_CFG.TIMEZONE, 'yyyy-MM');
}

function dailyKpiPeriodLabel_(period) {
  const p = String(period || '').split('-');
  return p.length === 2 ? p[1] + '/' + p[0] : String(period || '');
}


/* ============================================================
   KPI CONFIGURATION GOVERNANCE — ADMIN ONLY
   ------------------------------------------------------------
   Sheet: "Tỷ trọng KPI"
   - Versioned by Period.
   - ADMIN/SUPER_ADMIN can create a new active version.
   - AOM can approve Target Prod, but cannot change KPI weights/grade.
   - If a period has no saved config, the engine uses DEFAULT_WEIGHTS
     + DEFAULT_GRADE_RULES so KPI pages remain available.
   ============================================================ */

function dailyKpiDefaultConfig_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const weights = {};
  ['AMH','FM','LM'].forEach(function(type) {
    weights[type] = {};
    DAILY_KPI_CFG.KPI_KEYS.forEach(function(key) {
      weights[type][key] = Number((DAILY_KPI_CFG.DEFAULT_WEIGHTS[type] || {})[key] || 0);
    });
  });
  return {
    period:period,
    version:0,
    active:true,
    source:'DEFAULT_FALLBACK',
    weights:weights,
    grades:DAILY_KPI_CFG.DEFAULT_GRADE_RULES.map(function(r) {
      return {
        grade:r.grade,
        minPointPct:Number(r.minPointPct),
        maxPointPct:Number(r.maxPointPct)
      };
    }),
    createdBy:'',
    createdAt:'',
    lastLog:''
  };
}

function normalizeHubKpiType_(value) {
  const v = String(value || '').trim().toUpperCase();
  if (!v) return '';
  if (v === 'AMH' || /\bAMH\b/.test(v)) return 'AMH';
  if (v === 'FM' || /^FM[\s_-]/.test(v) || /\bFM HUB\b/.test(v)) return 'FM';
  if (v === 'LM' || /^LM[\s_-]/.test(v) || /\bLM HUB\b/.test(v)) return 'LM';
  return '';
}

function dailyKpiHubKpiType_(station) {
  station = station || {};
  const data = station.stationData || {};
  const candidates = [
    data['Hub type/KPI'],
    data['Hub Type/KPI'],
    data['Hub Type'],
    data['Type'],
    station.type
  ];

  Object.keys(data).forEach(function(key) {
    const nk = normalizePermissionHeader_(key);
    if (
      nk === 'hub type/kpi' ||
      nk === 'hub type' ||
      nk === 'type/kpi' ||
      nk === 'type'
    ) {
      candidates.push(data[key]);
    }
  });

  for (let i = 0; i < candidates.length; i++) {
    const type = normalizeHubKpiType_(candidates[i]);
    if (type) return type;
  }

  // Safe fallback: mixed-function stations use AMH weights.
  return 'AMH';
}

function buildKpiConfigModel_() {
  const ss = getDb_();
  const sheet = ss.getSheetByName(DAILY_KPI_CFG.CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return {
      sheetFound:!!sheet,
      sheetName:sheet ? sheet.getName() : DAILY_KPI_CFG.CONFIG_SHEET,
      generatedAt:new Date().toISOString(),
      rows:[]
    };
  }

  const width = DAILY_KPI_CFG.CONFIG_HEADERS.length;
  const raw = sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues();
  const disp = sheet.getRange(2,1,sheet.getLastRow()-1,width).getDisplayValues();
  const rows = [];

  raw.forEach(function(r, i) {
    const d = disp[i];
    const period = dailyKpiNormalizePeriod_(r[2] || d[2]);
    const type = String(d[1] || r[1] || '').trim().toUpperCase();
    if (!period || (type !== 'KPI_WEIGHT' && type !== 'GRADE')) return;
    rows.push({
      rowNumber:i+2,
      configId:String(d[0] || r[0] || ''),
      configType:type,
      period:period,
      hubType:normalizeHubKpiType_(d[3] || r[3]) || String(d[3] || r[3] || '').trim().toUpperCase(),
      kpiKey:String(d[4] || r[4] || '').trim(),
      weightPct:dailyKpiNumber_(r[5], d[5], 'NUMBER'),
      grade:String(d[6] || r[6] || '').trim().toUpperCase(),
      minPointPct:dailyKpiNumber_(r[7], d[7], 'NUMBER'),
      maxPointPct:dailyKpiNumber_(r[8], d[8], 'NUMBER'),
      version:Number(r[9] || d[9] || 0) || 0,
      active:toBool_(r[10] !== '' ? r[10] : d[10]),
      createdBy:normalizeEmail_(d[11] || r[11]),
      createdAt:toIso_(r[12] || d[12]),
      lastLog:String(d[13] || r[13] || '')
    });
  });

  return {
    sheetFound:true,
    sheetName:sheet.getName(),
    generatedAt:new Date().toISOString(),
    rows:rows
  };
}

function getKpiConfigModel_(forceRefresh) {
  if (forceRefresh === true) removeChunkedCacheJson_(CACHE_CFG.KPI_CONFIG_MODEL_KEY);
  const cached = getChunkedCacheJson_(CACHE_CFG.KPI_CONFIG_MODEL_KEY);
  if (cached) return cached;
  const built = buildKpiConfigModel_();
  putChunkedCacheJson_(CACHE_CFG.KPI_CONFIG_MODEL_KEY, built, CACHE_CFG.KPI_CONFIG_TTL_SEC);
  return built;
}

function resolveKpiConfig_(period, forceRefresh) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const model = getKpiConfigModel_(forceRefresh === true);
  const activeRows = (model.rows || []).filter(function(r) {
    return r.period === period && r.active;
  });

  if (!activeRows.length) {
    const fallback = dailyKpiDefaultConfig_(period);
    fallback.sheetFound = model.sheetFound;
    return fallback;
  }

  let version = 0;
  activeRows.forEach(function(r){ version = Math.max(version, Number(r.version || 0)); });
  const rows = activeRows.filter(function(r){ return Number(r.version || 0) === version; });
  const config = dailyKpiDefaultConfig_(period);
  config.version = version;
  config.source = 'SHEET';
  config.sheetFound = model.sheetFound;

  // Start from zero for a saved version: saved config is the source of truth.
  ['AMH','FM','LM'].forEach(function(type) {
    DAILY_KPI_CFG.KPI_KEYS.forEach(function(key){ config.weights[type][key] = 0; });
  });
  config.grades = [];

  rows.forEach(function(r) {
    if (r.configType === 'KPI_WEIGHT') {
      const type = normalizeHubKpiType_(r.hubType);
      if (type && DAILY_KPI_CFG.KPI_KEYS.indexOf(r.kpiKey) !== -1) {
        config.weights[type][r.kpiKey] = Number(r.weightPct || 0);
      }
    } else if (r.configType === 'GRADE' && r.grade) {
      config.grades.push({
        grade:r.grade,
        minPointPct:r.minPointPct == null ? null : Number(r.minPointPct),
        maxPointPct:r.maxPointPct == null ? null : Number(r.maxPointPct)
      });
    }
    if (!config.createdBy && r.createdBy) config.createdBy = r.createdBy;
    if (!config.createdAt && r.createdAt) config.createdAt = r.createdAt;
    if (!config.lastLog && r.lastLog) config.lastLog = r.lastLog;
  });

  if (!config.grades.length) {
    config.grades = dailyKpiDefaultConfig_(period).grades;
  }

  return config;
}

function validateKpiConfigurationPayload_(payload) {
  payload = payload || {};
  const period = dailyKpiNormalizePeriod_(payload.period) || dailyKpiCurrentPeriod_();
  const weights = payload.weights || {};
  const normalizedWeights = {};

  ['AMH','FM','LM'].forEach(function(type) {
    const src = weights[type] || {};
    normalizedWeights[type] = {};
    let total = 0;
    DAILY_KPI_CFG.KPI_KEYS.forEach(function(key) {
      const n = Number(src[key] == null ? 0 : src[key]);
      if (!isFinite(n) || n < 0 || n > 100) {
        throw new Error('KPI_WEIGHT_INVALID:' + type + ':' + key);
      }
      normalizedWeights[type][key] = n;
      total += n;
    });
    if (Math.abs(total - 100) > 0.001) {
      throw new Error(type + ' KPI Weight phải bằng 100%. Hiện tại = ' + total.toFixed(2) + '%');
    }
  });

  const grades = Array.isArray(payload.grades) ? payload.grades : [];
  const requiredGrades = ['A+','A','A-','B+','B','C'];
  const normalizedGrades = [];
  requiredGrades.forEach(function(grade) {
    const hit = grades.find(function(r){ return String(r && r.grade || '').trim().toUpperCase() === grade; });
    if (!hit) throw new Error('GRADE_RULE_MISSING:' + grade);
    const min = Number(hit.minPointPct);
    const max = Number(hit.maxPointPct);
    if (!isFinite(min) || !isFinite(max) || min < 0 || max < min) {
      throw new Error('GRADE_RULE_INVALID:' + grade);
    }
    normalizedGrades.push({ grade:grade, minPointPct:min, maxPointPct:max });
  });

  // Prevent overlapping / reversed grade bands.
  for (let i = 0; i < normalizedGrades.length - 1; i++) {
    if (!(normalizedGrades[i].minPointPct > normalizedGrades[i + 1].minPointPct)) {
      throw new Error('GRADE_MIN_ORDER_INVALID:' + normalizedGrades[i].grade);
    }
  }

  return { period:period, weights:normalizedWeights, grades:normalizedGrades };
}

function getKpiConfiguration(period, forceRefresh) {
  const access = requireAccess_(['dashboard', 'kpi']);
  const config = resolveKpiConfig_(period, forceRefresh === true);
  return {
    ok:true,
    period:config.period,
    periodLabel:dailyKpiPeriodLabel_(config.period),
    version:config.version,
    source:config.source,
    weights:config.weights,
    grades:config.grades,
    canEdit:normalizeRank_(access.rank) === 'ADMIN',
    createdBy:config.createdBy || '',
    createdAt:config.createdAt || '',
    lastLog:config.lastLog || '',
    serverTime:new Date().toISOString()
  };
}

function saveKpiConfiguration(payload) {
  throw new Error('KPI_SOURCE_ONLY: Manual KPI and target configuration is disabled. KPI results are read from source sheets.');
  const admin = requireAdmin_();
  const clean = validateKpiConfigurationPayload_(payload);

  return withShortWriteLock_(function() {
    ensureTargetProdSheets_();
    const sheet = getRequiredSheet_(DAILY_KPI_CFG.CONFIG_SHEET);
    const width = DAILY_KPI_CFG.CONFIG_HEADERS.length;
    const lastRow = sheet.getLastRow();
    let nextVersion = 1;

    if (lastRow >= 2) {
      const values = sheet.getRange(2,1,lastRow-1,width).getValues();
      const activeValues = sheet.getRange(2,11,lastRow-1,1).getValues();
      let activeChanged = false;

      values.forEach(function(r, i) {
        if (dailyKpiNormalizePeriod_(r[2]) !== clean.period) return;
        nextVersion = Math.max(nextVersion, Number(r[9] || 0) + 1);
        if (toBool_(r[10])) {
          activeValues[i][0] = false;
          activeChanged = true;
        }
      });

      if (activeChanged) sheet.getRange(2,11,lastRow-1,1).setValues(activeValues);
    }

    const now = new Date();
    const log = dailyKpiWriteLog_(
      'KPI_CONFIG_SAVE',
      admin.email,
      'Period=' + clean.period + ' | Version=' + nextVersion
    );
    const out = [];

    ['AMH','FM','LM'].forEach(function(type) {
      DAILY_KPI_CFG.KPI_KEYS.forEach(function(key) {
        out.push([
          Utilities.getUuid(),'KPI_WEIGHT',clean.period,type,key,
          clean.weights[type][key],'','','',
          nextVersion,true,admin.email,now,log
        ]);
      });
    });

    clean.grades.forEach(function(r) {
      out.push([
        Utilities.getUuid(),'GRADE',clean.period,'HUB','',
        '',r.grade,r.minPointPct,r.maxPointPct,
        nextVersion,true,admin.email,now,log
      ]);
    });

    if (out.length) {
      sheet.getRange(sheet.getLastRow()+1,1,out.length,width).setValues(out);
    }
    SpreadsheetApp.flush();

    removeChunkedCacheJson_(CACHE_CFG.KPI_CONFIG_MODEL_KEY);
    clearDailyKpiCaches_();

    return {
      ok:true,
      period:clean.period,
      version:nextVersion,
      savedRows:out.length,
      savedBy:admin.email,
      serverTime:new Date().toISOString()
    };
  });
}

function dailyKpiWeightsForStation_(config, station) {
  const hubType = dailyKpiHubKpiType_(station);
  const src = (config && config.weights && config.weights[hubType]) ||
    DAILY_KPI_CFG.DEFAULT_WEIGHTS[hubType] ||
    DAILY_KPI_CFG.DEFAULT_WEIGHTS.AMH;
  const out = {};
  DAILY_KPI_CFG.KPI_KEYS.forEach(function(key){ out[key] = Number(src[key] || 0); });
  return { hubType:hubType, weights:out };
}

function dailyKpiResolveGradeFromConfig_(finalPoint, config) {
  if (finalPoint == null || !isFinite(finalPoint)) return '';
  const pct = Number(finalPoint) * 100;
  const rules = ((config && config.grades) || DAILY_KPI_CFG.DEFAULT_GRADE_RULES)
    .slice()
    .sort(function(a,b){ return Number(b.minPointPct || 0) - Number(a.minPointPct || 0); });

  // Highest threshold is intentionally open-ended. This prevents a value
  // above the displayed A+ maximum from becoming ungraded.
  for (let i = 0; i < rules.length; i++) {
    if (pct >= Number(rules[i].minPointPct || 0)) return rules[i].grade;
  }
  return '';
}

function isProdTargetRequiredForRank_(rank) {
  rank = normalizeRank_(rank);
  return rank === 'SUP' || rank === 'HUB';
}

function dailyKpiFindSheet_(ss, aliases) {
  const normalized = (aliases || []).map(normalizeCompare_);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (normalized.indexOf(normalizeCompare_(sheets[i].getName())) !== -1) return sheets[i];
  }
  return null;
}

function dailyKpiDateKey_(raw, display) {
  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, DAILY_KPI_CFG.TIMEZONE, 'yyyy-MM-dd');
  }
  const s = String(display || raw || '').trim();
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function dailyKpiNumber_(raw, display, type) {
  let n = null;
  if (typeof raw === 'number' && isFinite(raw)) n = raw;
  else {
    let s = String(display == null ? raw : display).trim();
    if (!s || /^[-—]$/.test(s)) return null;
    const isPct = /%/.test(s);
    s = s.replace(/%/g,'').replace(/\s/g,'');
    if (/^-?\d{1,3}(?:\.\d{3})*,\d+$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
    else if (/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(s)) s = s.replace(/,/g,'');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',','.');
    n = Number(s);
    if (!isFinite(n)) return null;
    if (type === 'RATE' && isPct) n = n / 100;
  }
  if (type === 'RATE') {
    if (Math.abs(n) > 1.5 && Math.abs(n) <= 100.5) n = n / 100;
    if (!isFinite(n)) return null;
  }
  return n;
}

function dailyKpiFindWideDateRow_(raw, disp) {
  const max = Math.min(raw.length, 8);
  let best = null;
  for (let r = 0; r < max; r++) {
    let count = 0;
    for (let c = 1; c < raw[r].length; c++) {
      if (dailyKpiDateKey_(raw[r][c], disp[r][c])) count++;
    }
    if (count >= 2 && (!best || count > best.count)) best = { rowIndex:r, count:count };
  }
  return best ? best.rowIndex : 1;
}


function dailyKpiReadWide_(sheet, cfg, metricKey, matcher) {
  // V0.16 FULL-SHEET reader.
  // Always reads the entire physical sheet in one batch. This function is
  // intentionally not optimized to a date-column subset because correctness
  // is more important than micro-optimizing source reads.
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  if (raw.length < 2 || raw[0].length < 2) return [];

  const dateRow = dailyKpiFindWideDateRow_(raw, disp);
  const rows = [];

  for (let r = dateRow + 1; r < raw.length; r++) {
    const stationSource = String(disp[r][0] || raw[r][0] || '').trim();
    if (!stationSource) continue;

    const station = matcher.resolve(stationSource);
    if (!station) continue;

    for (let c = 1; c < raw[r].length; c++) {
      const dateKey = dailyKpiDateKey_(raw[dateRow][c], disp[dateRow][c]);
      if (!dateKey) continue;

      const value = dailyKpiNumber_(raw[r][c], disp[r][c], cfg.type);
      if (value == null) continue;

      rows.push({
        hubCode:station.hubCode,
        hubName:station.hubName,
        stationSource:stationSource,
        dateKey:dateKey,
        metricKey:metricKey,
        value:value,
        sourceSheet:sheet.getName()
      });
    }
  }
  return rows;
}

function dailyKpiHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach(function(h, i) {
    const k = normalizeKpiHeader_(h);
    if (k) map[k] = i;
  });
  return map;
}

function dailyKpiReadSorterLong_(sheet, matcher) {
  // V0.16 FULL-SHEET reader.
  // Uses BOTH getValues() and getDisplayValues(). Numeric/date logic uses the
  // raw value first and display value only as a fallback.
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  if (raw.length < 2) return [];

  const headers = disp[0].map(function(v){ return String(v || '').trim(); });
  const map = dailyKpiHeaderMap_(headers);

  function idx(names) {
    for (let i = 0; i < names.length; i++) {
      const hit = map[normalizeKpiHeader_(names[i])];
      if (hit !== undefined) return hit;
    }
    return -1;
  }

  const stationIdx = idx(['Station Name','Hub Name']);
  const dateIdx = idx(['Date']);
  const prodIdx = idx(['Sorter Prod','Sorter Productivity']);
  const volumeIdx = idx(['Total Volume','Volume','#Volume']);

  if (stationIdx < 0 || dateIdx < 0 || prodIdx < 0) return [];

  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const stationSource = String(disp[r][stationIdx] || raw[r][stationIdx] || '').trim();
    if (!stationSource) continue;

    const station = matcher.resolve(stationSource);
    if (!station) continue;

    const dateKey = dailyKpiDateKey_(raw[r][dateIdx], disp[r][dateIdx]);
    const value = dailyKpiNumber_(raw[r][prodIdx], disp[r][prodIdx], 'NUMBER');

    if (!dateKey || value == null) continue;

    const volume = volumeIdx >= 0
      ? dailyKpiNumber_(raw[r][volumeIdx], disp[r][volumeIdx], 'NUMBER')
      : null;

    rows.push({
      hubCode:station.hubCode,
      hubName:station.hubName,
      stationSource:stationSource,
      dateKey:dateKey,
      metricKey:'sorterProductivity',
      value:value,
      totalVolume:volume,
      sourceSheet:sheet.getName()
    });
  }
  return rows;
}

function dailyKpiPeriodCacheKey_(period) {
  return CACHE_CFG.DAILY_KPI_PERIOD_PREFIX + ':' + String(period || '');
}

function dailyKpiCollectWidePeriods_(sheet) {
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  if (raw.length < 2 || raw[0].length < 2) return [];

  const dateRow = dailyKpiFindWideDateRow_(raw, disp);
  const seen = {};

  for (let c = 1; c < raw[dateRow].length; c++) {
    const dateKey = dailyKpiDateKey_(raw[dateRow][c], disp[dateRow][c]);
    if (dateKey) seen[dateKey.slice(0,7)] = true;
  }
  return Object.keys(seen);
}

function dailyKpiCollectSorterPeriods_(sheet) {
  const range = sheet.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  if (raw.length < 2 || raw[0].length < 2) return [];

  const headers = disp[0].map(function(v){ return String(v || '').trim(); });
  const map = dailyKpiHeaderMap_(headers);
  const dateIdx = map[normalizeKpiHeader_('Date')];

  if (dateIdx === undefined) return [];

  const seen = {};
  for (let r = 1; r < raw.length; r++) {
    const dateKey = dailyKpiDateKey_(raw[r][dateIdx], disp[r][dateIdx]);
    if (dateKey) seen[dateKey.slice(0,7)] = true;
  }
  return Object.keys(seen);
}

function buildDailyKpiMeta_() {
  const ss = getDb_();
  const periods = {};
  const sourceMeta = {};

  Object.keys(DAILY_KPI_CFG.SOURCES).forEach(function(metricKey) {
    const cfg = DAILY_KPI_CFG.SOURCES[metricKey];
    const sheet = dailyKpiFindSheet_(ss, cfg.sheets);

    const meta = {
      found:!!sheet,
      sheetName:sheet ? sheet.getName() : '',
      readMode:'ALL_SHEET',
      physicalRows:sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
      physicalColumns:sheet ? sheet.getLastColumn() : 0,
      periods:[]
    };

    if (sheet) {
      try {
        meta.periods = cfg.layout === 'LONG_SORTER'
          ? dailyKpiCollectSorterPeriods_(sheet)
          : dailyKpiCollectWidePeriods_(sheet);
        meta.periods.forEach(function(p){ periods[p] = true; });
      } catch (err) {
        meta.error = err && err.message ? err.message : String(err);
      }
    }
    sourceMeta[metricKey] = meta;
  });

  return {
    generatedAt:new Date().toISOString(),
    readMode:'ALL_SHEET',
    periods:Object.keys(periods).sort().reverse(),
    sourceMeta:sourceMeta
  };
}

function getDailyKpiMetaModel_(forceRefresh) {
  if (forceRefresh === true) {
    removeChunkedCacheJson_(CACHE_CFG.DAILY_KPI_META_KEY);
    removePersistentJson_(RUNTIME_CFG.DAILY_META_PERSIST_KEY);
  }

  const cached = getChunkedCacheJson_(CACHE_CFG.DAILY_KPI_META_KEY);
  if (cached) return cached;

  const persisted = getPersistentJson_(RUNTIME_CFG.DAILY_META_PERSIST_KEY);
  if (persisted && forceRefresh !== true) {
    putChunkedCacheJson_(CACHE_CFG.DAILY_KPI_META_KEY, persisted, CACHE_CFG.DAILY_KPI_META_TTL_SEC);
    return persisted;
  }

  const built = buildDailyKpiMeta_();
  putChunkedCacheJson_(CACHE_CFG.DAILY_KPI_META_KEY, built, CACHE_CFG.DAILY_KPI_META_TTL_SEC);
  putPersistentJson_(RUNTIME_CFG.DAILY_META_PERSIST_KEY, built);
  return built;
}

/**
 * V0.16 source reader used by ETL.
 * IMPORTANT:
 * - Physically reads ALL rows and ALL columns of the source sheet.
 * - Filters the requested month only AFTER the full sheet has been read.
 * - This prevents date-column or row-window optimizations from silently
 *   excluding backfilled historical days.
 */
function dailyKpiReadSourceAllSheetForPeriod_(sheet, cfg, metricKey, matcher, period) {
  const allRows = cfg.layout === 'LONG_SORTER'
    ? dailyKpiReadSorterLong_(sheet, matcher)
    : dailyKpiReadWide_(sheet, cfg, metricKey, matcher);

  return allRows.filter(function(row) {
    return row && row.dateKey && row.dateKey.slice(0,7) === period;
  });
}

function dailyKpiSourceCoverage_(sheet, periodRows, period) {
  const dateSet = {};
  const hubSet = {};
  let minDate = '';
  let maxDate = '';

  (periodRows || []).forEach(function(r) {
    const dk = factDateKey_(r.dateKey);
    if (dk) {
      dateSet[dk] = true;
      if (!minDate || dk < minDate) minDate = dk;
      if (!maxDate || dk > maxDate) maxDate = dk;
    }
    if (r.hubCode) hubSet[normalizeCompare_(r.hubCode)] = true;
  });

  return {
    found:!!sheet,
    sheetName:sheet ? sheet.getName() : '',
    readMode:'ALL_SHEET',
    physicalRows:sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
    physicalColumns:sheet ? sheet.getLastColumn() : 0,
    period:period,
    periodRows:(periodRows || []).length,
    hubCount:Object.keys(hubSet).length,
    dateCount:Object.keys(dateSet).length,
    minDate:minDate,
    maxDate:maxDate
  };
}

function dailyKpiValidatePeriodModel_(model) {
  const warnings = [];
  const sourceMeta = (model && model.sourceMeta) || {};

  Object.keys(DAILY_KPI_CFG.SOURCES).forEach(function(metricKey) {
    const meta = sourceMeta[metricKey] || {};
    if (!meta.found) {
      warnings.push(metricKey + ': SOURCE_SHEET_NOT_FOUND');
      return;
    }
    if (!(Number(meta.periodRows || 0) > 0)) {
      warnings.push(metricKey + ': NO_ROWS_FOR_PERIOD');
    }
  });

  return {
    ok:warnings.length === 0,
    status:warnings.length ? 'READY_WITH_WARNINGS' : 'READY',
    warnings:warnings,
    readMode:'ALL_SHEET'
  };
}

/**
 * V0.16 CURRENT-PERIOD BUILDER
 * Every ETL build scans all 6 source sheets in full.
 * No date-column slicing and no row-window slicing are used.
 */
function buildDailyKpiPeriodModel_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();

  const ss = getDb_();
  const permission = getPermissionModel_(false);
  const allHubCodes = (permission.stations || []).map(function(s){ return s.hubCode; });
  const matcher = buildForecastStationMatcher_(permission.stations || [], allHubCodes);

  const sourceMeta = {};
  let longRows = [];

  Object.keys(DAILY_KPI_CFG.SOURCES).forEach(function(metricKey) {
    const cfg = DAILY_KPI_CFG.SOURCES[metricKey];
    const sheet = dailyKpiFindSheet_(ss, cfg.sheets);

    if (!sheet) {
      sourceMeta[metricKey] = dailyKpiSourceCoverage_(null, [], period);
      return;
    }

    const rows = dailyKpiReadSourceAllSheetForPeriod_(
      sheet,
      cfg,
      metricKey,
      matcher,
      period
    );

    sourceMeta[metricKey] = dailyKpiSourceCoverage_(sheet, rows, period);
    longRows = longRows.concat(rows);
  });

  const buckets = {};
  const dates = {};

  longRows.forEach(function(row) {
    const dateKey = factDateKey_(row.dateKey);
    if (!dateKey) return;

    const key = dateKey + '|' + normalizeCompare_(row.hubCode);
    if (!buckets[key]) {
      buckets[key] = {
        dateKey:dateKey,
        period:period,
        hubCode:row.hubCode,
        hubName:row.hubName,
        values:{},
        totalVolume:null,
        duplicateCounts:{},
        _values:{}
      };
    }

    const b = buckets[key];
    if (!b._values[row.metricKey]) b._values[row.metricKey] = [];
    b._values[row.metricKey].push(row.value);
    b.duplicateCounts[row.metricKey] = b._values[row.metricKey].length;

    if (row.totalVolume != null && isFinite(row.totalVolume)) {
      b.totalVolume = Number(row.totalVolume);
    }
    dates[dateKey] = true;
  });

  const rows = Object.keys(buckets).map(function(key) {
    const b = buckets[key];

    Object.keys(b._values || {}).forEach(function(metricKey) {
      const arr = b._values[metricKey].filter(function(v) {
        return typeof v === 'number' && isFinite(v);
      });

      b.values[metricKey] = arr.length
        ? arr.reduce(function(a,c){ return a + c; }, 0) / arr.length
        : null;
    });

    delete b._values;
    return b;
  }).sort(function(a,b) {
    return b.dateKey.localeCompare(a.dateKey) ||
      String(a.hubName || '').localeCompare(String(b.hubName || ''));
  });

  const model = {
    generatedAt:new Date().toISOString(),
    period:period,
    readMode:'ALL_SHEET',
    dates:Object.keys(dates).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_),
    sourceMeta:sourceMeta,
    rows:rows
  };

  model.validation = dailyKpiValidatePeriodModel_(model);
  return model;
}

function getDailyKpiPeriodModel_(period, forceRefresh) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const key = dailyKpiPeriodCacheKey_(period);

  if (forceRefresh === true) removeChunkedCacheJson_(key);

  const cached = getChunkedCacheJson_(key);
  if (cached && forceRefresh !== true) return cached;

  // Read-through materialized fact: one compact system sheet instead of six
  // source-sheet scans on a cold web request.
  if (forceRefresh !== true) {
    const materialized = readDailyKpiMaterializedPeriod_(period);
    if (materialized) {
      putChunkedCacheJson_(key, materialized, CACHE_CFG.DAILY_KPI_TTL_SEC);
      return materialized;
    }
  }

  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(CACHE_CFG.COLD_CACHE_LOCK_MS);
    if (locked) {
      const retry = getChunkedCacheJson_(key);
      if (retry && forceRefresh !== true) return retry;

      const built = buildDailyKpiPeriodModel_(period);
      persistDailyKpiMaterializedPeriod_(built);
      putChunkedCacheJson_(key, built, CACHE_CFG.DAILY_KPI_TTL_SEC);
      return built;
    }
  } finally {
    if (locked) lock.releaseLock();
  }

  Utilities.sleep(40);
  const retry = getChunkedCacheJson_(key) || readDailyKpiMaterializedPeriod_(period);
  if (retry) return retry;

  const built = buildDailyKpiPeriodModel_(period);
  persistDailyKpiMaterializedPeriod_(built);
  putChunkedCacheJson_(key, built, CACHE_CFG.DAILY_KPI_TTL_SEC);
  return built;
}


function clearDailyKpiCaches_() {
  let periods = [];
  try { periods = (getDailyKpiMetaModel_(false).periods || []).slice(); } catch (_) {}
  periods.push(dailyKpiCurrentPeriod_());
  const seen = {};
  periods.forEach(function(period) {
    period = dailyKpiNormalizePeriod_(period);
    if (!period || seen[period]) return;
    seen[period] = true;
    removeChunkedCacheJson_(dailyKpiPeriodCacheKey_(period));
  });
  removeChunkedCacheJson_(CACHE_CFG.DAILY_KPI_META_KEY);
}

function dailyKpiMetricPctCell_(value) {
  return value == null || !isFinite(value) ? null : Number(value) * 100;
}

function dailyKpiTargetRawPct_(actual, target) {
  if (actual == null || !isFinite(actual) || !(Number(target) > 0)) return null;
  return Number(actual) / Number(target) * 100;
}

function dailyKpiTargetCell_(actual, target) {
  const rawPct = dailyKpiTargetRawPct_(actual, target);
  if (rawPct == null || !isFinite(rawPct)) return null;
  // Business rule: displayed/scored productivity is bounded to 0%..120%.
  return Math.max(0, Math.min(rawPct, 120));
}

function dailyKpiProdScore_(actual, target) {
  const pct = dailyKpiTargetCell_(actual, target);
  return pct == null ? null : pct / 100;
}

function dailyKpiScoreRow_(base, target, station, config) {
  const v = base.values || {};
  const stationCfg = dailyKpiWeightsForStation_(config, station || {});
  const hubType = stationCfg.hubType;
  const weights = stationCfg.weights;

  const actuals = {
    fmOntime:v.fmOntime,
    lmOntime:v.lmOntime,
    deliSuccess:v.deliSuccess,
    correctSopPu:v.correctSopPu,
    riderProductivity:v.riderProductivity,
    sorterProductivity:v.sorterProductivity
  };

  const riderTarget = target && Number(target.riderTarget) > 0 ? Number(target.riderTarget) : null;
  const sorterTarget = target && Number(target.sorterTarget) > 0 ? Number(target.sorterTarget) : null;

  const missing = [];
  function requireMetric(key, label) {
    if (Number(weights[key] || 0) > 0 && (actuals[key] == null || !isFinite(actuals[key]))) {
      missing.push(label);
    }
  }

  requireMetric('fmOntime','%FM Ontime');
  requireMetric('lmOntime','%LM Ontime');
  requireMetric('deliSuccess','%Deli Success');
  requireMetric('correctSopPu','%Correct SOP - PU');
  requireMetric('riderProductivity','Rider Prod');
  requireMetric('sorterProductivity','Sorter Prod');

  if (Number(weights.riderProductivity || 0) > 0 && !(riderTarget > 0)) {
    missing.push('Rider Target');
  }
  if (Number(weights.sorterProductivity || 0) > 0 && !(sorterTarget > 0)) {
    missing.push('Sorter Target');
  }

  const riderScore = dailyKpiProdScore_(actuals.riderProductivity, riderTarget);
  const sorterScore = dailyKpiProdScore_(actuals.sorterProductivity, sorterTarget);

  const rateScores = {
    fmOntime:actuals.fmOntime == null ? null : Math.max(0, Math.min(Number(actuals.fmOntime), 1.00)),
    lmOntime:actuals.lmOntime == null ? null : Math.max(0, Math.min(Number(actuals.lmOntime), 1.00)),
    deliSuccess:actuals.deliSuccess == null ? null : Math.max(0, Math.min(Number(actuals.deliSuccess), 1.00)),
    correctSopPu:actuals.correctSopPu == null ? null : Math.max(0, Math.min(Number(actuals.correctSopPu), 1.00)),
    riderProductivity:riderScore,
    sorterProductivity:sorterScore
  };

  let finalPoint = null;
  const contributions = {};
  if (!missing.length) {
    finalPoint = 0;
    DAILY_KPI_CFG.KPI_KEYS.forEach(function(key) {
      const weightPct = Number(weights[key] || 0);
      const score = rateScores[key];
      const contribution = weightPct > 0 && score != null
        ? Number(score) * weightPct / 100
        : 0;
      contributions[key] = contribution * 100;
      finalPoint += contribution;
    });
  }

  const grade = dailyKpiResolveGradeFromConfig_(finalPoint, config);
  const riderRawPct = dailyKpiTargetRawPct_(actuals.riderProductivity, riderTarget);
  const sorterRawPct = dailyKpiTargetRawPct_(actuals.sorterProductivity, sorterTarget);

  return {
    dateKey:base.dateKey,
    dateLabel:forecastDateLabel_(base.dateKey),
    hubCode:base.hubCode,
    hubName:base.hubName,
    hubType:hubType,
    grade:grade,
    finalPoint:finalPoint,
    finalPointPct:finalPoint == null ? null : finalPoint * 100,
    totalVolume:base.totalVolume,
    complete:!missing.length,
    missing:missing,
    weights:weights,
    contributions:contributions,
    fmOntime:dailyKpiMetricPctCell_(actuals.fmOntime),
    lmOntime:dailyKpiMetricPctCell_(actuals.lmOntime),
    deliSuccess:dailyKpiMetricPctCell_(actuals.deliSuccess),
    correctSopPu:dailyKpiMetricPctCell_(actuals.correctSopPu),
    riderActual:actuals.riderProductivity,
    riderTarget:riderTarget,
    riderProductivityPct:dailyKpiTargetCell_(actuals.riderProductivity, riderTarget),
    riderProductivityRawPct:riderRawPct,
    riderProductivityCapped:riderRawPct != null && riderRawPct > 120,
    sorterActual:actuals.sorterProductivity,
    sorterTarget:sorterTarget,
    sorterProductivityPct:dailyKpiTargetCell_(actuals.sorterProductivity, sorterTarget),
    sorterProductivityRawPct:sorterRawPct,
    sorterProductivityCapped:sorterRawPct != null && sorterRawPct > 120,
    duplicateCounts:base.duplicateCounts || {}
  };
}

function targetProdSourceHeaderKey_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function targetProdSourceFindColumn_(headers, aliases) {
  const map = {};
  (headers || []).forEach(function(h, i) {
    const key = targetProdSourceHeaderKey_(h);
    if (key && map[key] === undefined) map[key] = i;
  });
  for (let i = 0; i < (aliases || []).length; i++) {
    const hit = map[targetProdSourceHeaderKey_(aliases[i])];
    if (hit !== undefined) return hit;
  }
  return -1;
}

function targetProdSourcePeriod_(raw, display) {
  const direct = dailyKpiNormalizePeriod_(raw) || dailyKpiNormalizePeriod_(display);
  if (direct) return direct;

  const text = String(display || raw || '').trim();
  if (!text) return '';

  // Example source: 01/08/2026 - 31/08/2026
  let m = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2);

  m = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);
  return '';
}

function dailyKpiPreviousPeriod_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const p = period.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!y || !m) return '';
  const d = new Date(y, m - 2, 1, 12, 0, 0);
  return Utilities.formatDate(d, DAILY_KPI_CFG.TIMEZONE, 'yyyy-MM');
}

function dailyKpiSuggestedTargetValue_(value) {
  value = Number(value);
  if (!isFinite(value) || value <= 0) return null;
  return Math.round(value * 1.05);
}

function buildOfficialTargetProdRows_(ss) {
  const aliases = DAILY_KPI_CFG.TARGET_SOURCE_ALIASES || [DAILY_KPI_CFG.TARGET_SOURCE_SHEET];
  const normalized = aliases.map(normalizeCompare_);
  let sheet = ss.getSheetByName(DAILY_KPI_CFG.TARGET_SOURCE_SHEET);
  if (!sheet) {
    sheet = ss.getSheets().find(function(sh) {
      return normalized.indexOf(normalizeCompare_(sh.getName())) !== -1;
    }) || null;
  }

  const result = {
    sheetFound:!!sheet,
    sheetName:sheet ? sheet.getName() : DAILY_KPI_CFG.TARGET_SOURCE_SHEET,
    rows:[],
    error:''
  };
  if (!sheet || sheet.getLastRow() < 2) return result;

  const range = sheet.getDataRange();
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  if (!raw.length) return result;

  let headerRow = -1;
  let cols = null;
  const maxHeaderRows = Math.min(20, raw.length);

  for (let r = 0; r < maxHeaderRows; r++) {
    const headers = disp[r] || [];
    const periodIdx = targetProdSourceFindColumn_(headers, ['Period','Tháng','Month']);
    const hubIdx = targetProdSourceFindColumn_(headers, ['Hub','Hub Name','Station','Station Name','Profile Station','Profit Station']);
    const riderIdx = targetProdSourceFindColumn_(headers, [
      'Mục tiêu năng suất nhân viên giao nhận',
      'Muc tieu nang suat nhan vien giao nhan',
      'Target Rider Prod','Rider Target'
    ]);
    const sorterIdx = targetProdSourceFindColumn_(headers, [
      'Mục tiêu năng suất nhân viên kho',
      'Muc tieu nang suat nhan vien kho',
      'Target Sorter Prod','Sorter Target'
    ]);
    if (periodIdx >= 0 && hubIdx >= 0 && (riderIdx >= 0 || sorterIdx >= 0)) {
      headerRow = r;
      cols = {
        period:periodIdx,
        region:targetProdSourceFindColumn_(headers, ['Vùng','Vung','Region']),
        stationCode:targetProdSourceFindColumn_(headers, ['Station Code','Hub Code']),
        hub:hubIdx,
        rider:riderIdx,
        sorter:sorterIdx
      };
      break;
    }
  }

  if (headerRow < 0 || !cols) {
    result.error = 'TARGET_PROD_KPI_HEADER_NOT_FOUND';
    return result;
  }

  for (let r = headerRow + 1; r < raw.length; r++) {
    const period = targetProdSourcePeriod_(raw[r][cols.period], disp[r][cols.period]);
    const hubName = String(disp[r][cols.hub] || raw[r][cols.hub] || '').trim();
    if (!period || !hubName) continue;

    const hubCode = cols.stationCode >= 0
      ? String(disp[r][cols.stationCode] || raw[r][cols.stationCode] || '').trim()
      : '';
    const rider = cols.rider >= 0
      ? dailyKpiNumber_(raw[r][cols.rider], disp[r][cols.rider], 'NUMBER')
      : null;
    const sorter = cols.sorter >= 0
      ? dailyKpiNumber_(raw[r][cols.sorter], disp[r][cols.sorter], 'NUMBER')
      : null;

    result.rows.push({
      rowNumber:r + 1,
      period:period,
      hubName:hubName,
      hubCode:hubCode,
      hubKey:forecastCanonicalHubKey_(hubName),
      riderTarget:rider,
      sorterTarget:sorter,
      source:'TARGET_PROD_KPI',
      sourceLabel:'Target Prod KPI',
      priority:1,
      lastLog:'Official source: ' + result.sheetName + ' row ' + (r + 1)
    });
  }

  result.headerRow = headerRow + 1;
  result.columns = cols;
  return result;
}

function buildManualTargetProdRows_(ss) {
  const sheet = ss.getSheetByName(DAILY_KPI_CFG.TARGET_SHEET);
  const rows = [];
  if (sheet && sheet.getLastRow() >= 2) {
    const raw = sheet.getRange(2,1,sheet.getLastRow()-1,DAILY_KPI_CFG.TARGET_HEADERS.length).getValues();
    const disp = sheet.getRange(2,1,sheet.getLastRow()-1,DAILY_KPI_CFG.TARGET_HEADERS.length).getDisplayValues();
    raw.forEach(function(r, i) {
      const period = dailyKpiNormalizePeriod_(r[0] || disp[i][0]);
      const hubName = String(disp[i][1] || r[1] || '').trim();
      if (!period || !hubName) return;
      rows.push({
        rowNumber:i+2,
        period:period,
        hubName:hubName,
        hubCode:'',
        hubKey:forecastCanonicalHubKey_(hubName),
        riderTarget:dailyKpiNumber_(r[2], disp[i][2], 'NUMBER'),
        sorterTarget:dailyKpiNumber_(r[3], disp[i][3], 'NUMBER'),
        source:'TARGET_PROD_MANUAL',
        sourceLabel:'Manual / approved request',
        priority:2,
        lastLog:String(disp[i][4] || r[4] || '')
      });
    });
  }
  return {
    sheetFound:!!sheet,
    sheetName:sheet ? sheet.getName() : DAILY_KPI_CFG.TARGET_SHEET,
    rows:rows
  };
}

function buildTargetProdModel_(forceRefresh) {
  if (forceRefresh === true) removeChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);
  const cached = getChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);
  if (cached) return cached;

  const ss = getDb_();
  const official = buildOfficialTargetProdRows_(ss);
  const manual = buildManualTargetProdRows_(ss);
  const rows = (official.rows || []).concat(manual.rows || []);

  const model = {
    sheetFound:official.sheetFound || manual.sheetFound,
    sheetName:official.sheetFound ? official.sheetName : manual.sheetName,
    officialSheetFound:official.sheetFound,
    officialSheetName:official.sheetName,
    officialError:official.error || '',
    manualSheetFound:manual.sheetFound,
    manualSheetName:manual.sheetName,
    generatedAt:new Date().toISOString(),
    rows:rows
  };
  putChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY, model, CACHE_CFG.TARGET_PROD_TTL_SEC);
  return model;
}

function dailyKpiTargetMatchesStation_(row, station) {
  if (!row || !station) return false;
  const stationCode = normalizeCompare_(station.hubCode || '');
  const rowCode = normalizeCompare_(row.hubCode || '');
  if (stationCode && rowCode && stationCode === rowCode) return true;

  const exact = normalizeStationName_(station.hubName);
  if (normalizeStationName_(row.hubName) === exact) return true;

  const canonical = forecastCanonicalHubKey_(station.hubName);
  return !!(canonical && row.hubKey === canonical);
}

function dailyKpiTargetByHub_(model, period, station) {
  const candidates = (model.rows || []).filter(function(r) {
    return r.period === period && dailyKpiTargetMatchesStation_(r, station);
  }).sort(function(a,b) {
    return Number(a.priority || 99) - Number(b.priority || 99) || Number(b.rowNumber || 0) - Number(a.rowNumber || 0);
  });

  if (!candidates.length) return null;

  let rider = null, sorter = null, riderRow = null, sorterRow = null;
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i];
    if (!(rider > 0) && Number(r.riderTarget) > 0) {
      rider = Number(r.riderTarget);
      riderRow = r;
    }
    if (!(sorter > 0) && Number(r.sorterTarget) > 0) {
      sorter = Number(r.sorterTarget);
      sorterRow = r;
    }
    if (rider > 0 && sorter > 0) break;
  }

  const sourceSet = {};
  if (riderRow) sourceSet[riderRow.source] = true;
  if (sorterRow) sourceSet[sorterRow.source] = true;
  const sourceKeys = Object.keys(sourceSet);
  const source = sourceKeys.length === 1 ? sourceKeys[0] : (sourceKeys.length > 1 ? 'MIXED' : 'MISSING');
  const officialCurrent = (riderRow && riderRow.source === 'TARGET_PROD_KPI') || (sorterRow && sorterRow.source === 'TARGET_PROD_KPI');

  return {
    period:period,
    hubName:station.hubName,
    hubCode:station.hubCode,
    riderTarget:rider,
    sorterTarget:sorter,
    riderSource:riderRow ? riderRow.source : '',
    sorterSource:sorterRow ? sorterRow.source : '',
    riderSourceLabel:riderRow ? riderRow.sourceLabel : '',
    sorterSourceLabel:sorterRow ? sorterRow.sourceLabel : '',
    source:source,
    sourceLabel:source === 'TARGET_PROD_KPI' ? 'Target Prod KPI' : (source === 'TARGET_PROD_MANUAL' ? 'Manual / approved request' : (source === 'MIXED' ? 'Mixed source' : 'Missing')),
    officialCurrent:!!officialCurrent,
    lastLog:(riderRow && riderRow.lastLog) || (sorterRow && sorterRow.lastLog) || ''
  };
}

function dailyKpiTargetSuggestion_(model, period, station) {
  const previousPeriod = dailyKpiPreviousPeriod_(period);
  if (!previousPeriod) return { previousPeriod:'', riderTarget:null, sorterTarget:null, source:'' };
  const previous = dailyKpiTargetByHub_(model, previousPeriod, station);
  if (!previous) return { previousPeriod:previousPeriod, riderTarget:null, sorterTarget:null, source:'' };
  return {
    previousPeriod:previousPeriod,
    previousPeriodLabel:dailyKpiPeriodLabel_(previousPeriod),
    riderBase:Number(previous.riderTarget) > 0 ? Number(previous.riderTarget) : null,
    sorterBase:Number(previous.sorterTarget) > 0 ? Number(previous.sorterTarget) : null,
    riderTarget:dailyKpiSuggestedTargetValue_(previous.riderTarget),
    sorterTarget:dailyKpiSuggestedTargetValue_(previous.sorterTarget),
    source:previous.source || '',
    sourceLabel:previous.sourceLabel || ''
  };
}

function getTargetProdStatusInternal_(access, resolved, period, hubCodes, forceRefresh, permission, config) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  permission = permission || getPermissionModel_(false);
  config = config || resolveKpiConfig_(period, false);
  const model = buildTargetProdModel_(forceRefresh === true);
  const pending = getTargetProdPendingMap_(access, period);

  const rows = (hubCodes || []).map(function(code) {
    const station = stationByHubCode_(permission, code);
    if (!station) return null;

    const t = dailyKpiTargetByHub_(model, period, station);
    const suggestion = dailyKpiTargetSuggestion_(model, period, station);
    const stationCfg = dailyKpiWeightsForStation_(config, station);
    const riderNeeded = Number(stationCfg.weights.riderProductivity || 0) > 0;
    const sorterNeeded = Number(stationCfg.weights.sorterProductivity || 0) > 0;
    const riderTarget = t && Number(t.riderTarget) > 0 ? Number(t.riderTarget) : null;
    const sorterTarget = t && Number(t.sorterTarget) > 0 ? Number(t.sorterTarget) : null;
    const missingRider = riderNeeded && !(riderTarget > 0);
    const missingSorter = sorterNeeded && !(sorterTarget > 0);

    return {
      hubCode:station.hubCode,
      hubName:station.hubName,
      hubType:stationCfg.hubType,
      riderTarget:riderTarget,
      sorterTarget:sorterTarget,
      riderNeeded:riderNeeded,
      sorterNeeded:sorterNeeded,
      riderSource:t ? t.riderSource : '',
      sorterSource:t ? t.sorterSource : '',
      targetSource:t ? t.source : 'MISSING',
      targetSourceLabel:t ? t.sourceLabel : 'Missing',
      officialCurrent:!!(t && t.officialCurrent),
      lastLog:t ? t.lastLog : '',
      missingRider:missingRider,
      missingSorter:missingSorter,
      suggestedRiderTarget:missingRider ? suggestion.riderTarget : null,
      suggestedSorterTarget:missingSorter ? suggestion.sorterTarget : null,
      suggestionRiderBase:suggestion.riderBase,
      suggestionSorterBase:suggestion.sorterBase,
      suggestionPeriod:suggestion.previousPeriod || '',
      suggestionPeriodLabel:suggestion.previousPeriodLabel || '',
      suggestionSource:suggestion.source || '',
      suggestionSourceLabel:suggestion.sourceLabel || '',
      pending:pending[normalizeCompare_(station.hubCode)] || null
    };
  }).filter(Boolean);

  const missing = rows.filter(function(r){ return r.missingRider || r.missingSorter; });
  const rank = normalizeRank_(access.rank);
  const required = isProdTargetRequiredForRank_(rank);

  return {
    ok:true,
    period:period,
    periodLabel:dailyKpiPeriodLabel_(period),
    rank:rank,
    targetRequired:required,
    targetMode:required ? 'REQUIRED' : 'OPTIONAL',
    scopeHubCount:rows.length,
    completeHubCount:rows.length-missing.length,
    missingHubCount:missing.length,
    rows:rows,
    missing:missing,
    sheetFound:model.sheetFound,
    officialSheetFound:model.officialSheetFound,
    officialSheetName:model.officialSheetName,
    officialError:model.officialError || '',
    manualSheetFound:model.manualSheetFound,
    manualSheetName:model.manualSheetName,
    targetPriority:['Target Prod KPI','Manual / approved request'],
    canInitialize:true,
    canApprove:rank === 'ADMIN' || rank === 'AOM',
    configVersion:config.version || 0,
    configSource:config.source || 'DEFAULT_FALLBACK',
    serverTime:new Date().toISOString()
  };
}

function getTargetProdStatus(path, period, selectedHubCodes, forceRefresh) {
  const access = requireAccess_(['dashboard', 'kpi']);
  const resolved = assertDrillPathAccess_(access, path || {});
  const hubCodes = resolveSelectedAuthorizedHubCodes_(resolved.view, selectedHubCodes);
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const permission = getPermissionModel_(false);
  const config = resolveKpiConfig_(period, false);
  return getTargetProdStatusInternal_(
    access,
    resolved,
    period,
    hubCodes,
    forceRefresh === true,
    permission,
    config
  );
}

function dailyKpiWriteLog_(action, userEmail, detail) {
  return Utilities.formatDate(new Date(), DAILY_KPI_CFG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss') +
    ' | ' + action + ' | ' + normalizeEmail_(userEmail) + (detail ? ' | ' + detail : '');
}

function dailyKpiFindTargetPhysicalRow_(sheet, period, hubName) {
  if (sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,5).getDisplayValues();
  const exact = normalizeStationName_(hubName);
  const canonical = forecastCanonicalHubKey_(hubName);
  for (let i = 0; i < values.length; i++) {
    if (dailyKpiNormalizePeriod_(values[i][0]) !== period) continue;
    const key = normalizeStationName_(values[i][1]);
    const c = forecastCanonicalHubKey_(values[i][1]);
    if (key === exact || (canonical && c === canonical)) return { row:i+2, values:values[i] };
  }
  return null;
}

function dailyKpiAssertHubAccess_(access, hubCode) {
  const permission = getPermissionModel_(false);
  const station = stationByHubCode_(permission, hubCode);
  if (!station) throw new Error('TARGET_HUB_NOT_FOUND:' + hubCode);
  if (normalizeRank_(access.rank) !== 'ADMIN') {
    const allowed = makeHubSet_(access.hubCodes || []);
    if (!allowed[normalizeCompare_(station.hubCode)]) throw new Error('TARGET_HUB_DENIED:' + hubCode);
  }
  return station;
}

function saveInitialProdTargets(payload) {
  throw new Error('KPI_SOURCE_ONLY: Manual KPI and target configuration is disabled. KPI results are read from source sheets.');
  const access = requireAccess_();
  payload = payload || {};
  const period = dailyKpiNormalizePeriod_(payload.period) || dailyKpiCurrentPeriod_();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('TARGET_NO_ITEMS');

  return withShortWriteLock_(function() {
    ensureTargetProdSheets_();
    const sheet = getRequiredSheet_(DAILY_KPI_CFG.TARGET_SHEET);
    let saved = 0;
    const results = [];
    items.forEach(function(item) {
      const station = dailyKpiAssertHubAccess_(access, item.hubCode);
      const rider = Number(item.riderTarget);
      const sorter = Number(item.sorterTarget);
      const found = dailyKpiFindTargetPhysicalRow_(sheet, period, station.hubName);
      let oldRider = found ? dailyKpiNumber_(found.values[2], found.values[2], 'NUMBER') : null;
      let oldSorter = found ? dailyKpiNumber_(found.values[3], found.values[3], 'NUMBER') : null;
      let newRider = oldRider;
      let newSorter = oldSorter;
      const changed = [];
      if (!(oldRider > 0) && isFinite(rider) && rider > 0) { newRider = rider; changed.push('Rider=' + rider); }
      if (!(oldSorter > 0) && isFinite(sorter) && sorter > 0) { newSorter = sorter; changed.push('Sorter=' + sorter); }
      if (!changed.length) {
        results.push({ hubCode:station.hubCode, saved:false, reason:'TARGET_ALREADY_EXISTS_OR_NO_VALUE' });
        return;
      }
      const log = dailyKpiWriteLog_('INITIAL', access.email, changed.join(' | '));
      const row = [[period, station.hubName, newRider || '', newSorter || '', log]];
      if (found) sheet.getRange(found.row,1,1,5).setValues(row);
      else sheet.appendRow(row[0]);
      saved++;
      results.push({ hubCode:station.hubCode, saved:true });
    });
    SpreadsheetApp.flush();
    removeChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);
    return { ok:true, period:period, saved:saved, results:results, by:access.email };
  });
}

function getTargetProdPendingMap_(access, period) {
  const ss = getDb_();
  const sheet = ss.getSheetByName(DAILY_KPI_CFG.REQUEST_SHEET);
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getRange(2,1,sheet.getLastRow()-1,DAILY_KPI_CFG.REQUEST_HEADERS.length).getDisplayValues();
  values.forEach(function(r) {
    if (String(r[10] || '').toUpperCase() !== 'PENDING') return;
    if (dailyKpiNormalizePeriod_(r[1]) !== period) return;
    const code = String(r[3] || '').trim();
    if (!code) return;
    if (normalizeRank_(access.rank) !== 'ADMIN') {
      const allowed = makeHubSet_(access.hubCodes || []);
      if (!allowed[normalizeCompare_(code)]) return;
    }
    out[normalizeCompare_(code)] = { requestId:r[0], requestedBy:r[8], requestedAt:r[9] };
  });
  return out;
}

function requestProdTargetChange(payload) {
  throw new Error('KPI_SOURCE_ONLY: Manual KPI and target configuration is disabled. KPI results are read from source sheets.');
  const access = requireAccess_();
  payload = payload || {};
  const period = dailyKpiNormalizePeriod_(payload.period) || dailyKpiCurrentPeriod_();
  const station = dailyKpiAssertHubAccess_(access, payload.hubCode);
  const model = buildTargetProdModel_(false);
  const current = dailyKpiTargetByHub_(model, period, station);
  if (!current) throw new Error('TARGET_NOT_INITIALIZED');
  const newRider = Number(payload.riderTarget);
  const newSorter = Number(payload.sorterTarget);
  const riderVal = isFinite(newRider) && newRider > 0 ? newRider : current.riderTarget;
  const sorterVal = isFinite(newSorter) && newSorter > 0 ? newSorter : current.sorterTarget;
  if (Number(current.riderTarget || 0) === Number(riderVal || 0) && Number(current.sorterTarget || 0) === Number(sorterVal || 0)) throw new Error('TARGET_NO_CHANGE');

  return withShortWriteLock_(function() {
    ensureTargetProdSheets_();
    const sheet = getRequiredSheet_(DAILY_KPI_CFG.REQUEST_SHEET);
    const existing = getTargetProdPendingMap_(access, period)[normalizeCompare_(station.hubCode)];
    if (existing) throw new Error('TARGET_PENDING_EXISTS:' + existing.requestId);
    const requestId = Utilities.getUuid();
    const now = new Date();
    sheet.appendRow([
      requestId, period, station.hubName, station.hubCode,
      current.riderTarget || '', riderVal || '',
      current.sorterTarget || '', sorterVal || '',
      access.email, now, 'PENDING', '', '', cleanText_(payload.note || '', 500)
    ]);
    SpreadsheetApp.flush();
    return { ok:true, requestId:requestId, status:'PENDING', period:period, hubCode:station.hubCode, requestedBy:access.email };
  });
}

function requireTargetApprover_() {
  const access = requireAccess_();
  const rank = normalizeRank_(access.rank);
  if (rank !== 'ADMIN' && rank !== 'AOM') throw new Error('TARGET_APPROVER_REQUIRED');
  return access;
}

function getTargetProdRequests(status, forceRefresh) {
  const access = requireTargetApprover_();
  status = String(status || 'PENDING').toUpperCase();
  const ss = getDb_();
  const sheet = ss.getSheetByName(DAILY_KPI_CFG.REQUEST_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { ok:true, rows:[], status:status };
  const raw = sheet.getRange(2,1,sheet.getLastRow()-1,DAILY_KPI_CFG.REQUEST_HEADERS.length).getValues();
  const disp = sheet.getRange(2,1,sheet.getLastRow()-1,DAILY_KPI_CFG.REQUEST_HEADERS.length).getDisplayValues();
  const allowed = normalizeRank_(access.rank) === 'ADMIN' ? null : makeHubSet_(access.hubCodes || []);
  const rows = [];
  raw.forEach(function(r, i) {
    const rowStatus = String(disp[i][10] || r[10] || '').toUpperCase();
    if (status !== 'ALL' && rowStatus !== status) return;
    const hubCode = String(disp[i][3] || r[3] || '').trim();
    if (allowed && !allowed[normalizeCompare_(hubCode)]) return;
    rows.push({
      rowNumber:i+2, requestId:String(disp[i][0] || r[0] || ''),
      period:dailyKpiNormalizePeriod_(disp[i][1] || r[1]), hubName:String(disp[i][2] || r[2] || ''), hubCode:hubCode,
      oldRiderTarget:dailyKpiNumber_(r[4],disp[i][4],'NUMBER'), newRiderTarget:dailyKpiNumber_(r[5],disp[i][5],'NUMBER'),
      oldSorterTarget:dailyKpiNumber_(r[6],disp[i][6],'NUMBER'), newSorterTarget:dailyKpiNumber_(r[7],disp[i][7],'NUMBER'),
      requestedBy:String(disp[i][8] || r[8] || ''), requestedAt:toIso_(r[9] || disp[i][9]), status:rowStatus,
      reviewedBy:String(disp[i][11] || r[11] || ''), reviewedAt:toIso_(r[12] || disp[i][12]), reviewNote:String(disp[i][13] || r[13] || '')
    });
  });
  rows.sort(function(a,b){ return String(b.requestedAt).localeCompare(String(a.requestedAt)); });
  return { ok:true, status:status, rank:access.rank, rows:rows, count:rows.length, serverTime:new Date().toISOString() };
}

function reviewTargetProdRequest(requestId, decision, note) {
  throw new Error('KPI_SOURCE_ONLY: Manual KPI and target configuration is disabled. KPI results are read from source sheets.');
  const access = requireTargetApprover_();
  requestId = String(requestId || '').trim();
  decision = String(decision || '').trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new Error('TARGET_REVIEW_DECISION_INVALID');

  return withShortWriteLock_(function() {
    ensureTargetProdSheets_();
    const reqSheet = getRequiredSheet_(DAILY_KPI_CFG.REQUEST_SHEET);
    const values = reqSheet.getRange(2,1,Math.max(0,reqSheet.getLastRow()-1),DAILY_KPI_CFG.REQUEST_HEADERS.length).getValues();
    let hit = null;
    for (let i=0;i<values.length;i++) if (String(values[i][0] || '') === requestId) { hit={ row:i+2, values:values[i] }; break; }
    if (!hit) throw new Error('TARGET_REQUEST_NOT_FOUND');
    if (String(hit.values[10] || '').toUpperCase() !== 'PENDING') throw new Error('TARGET_REQUEST_ALREADY_REVIEWED');
    const period = dailyKpiNormalizePeriod_(hit.values[1]);
    const hubName = String(hit.values[2] || '');
    const hubCode = String(hit.values[3] || '');
    const station = dailyKpiAssertHubAccess_(access, hubCode);
    const now = new Date();

    if (decision === 'APPROVE') {
      const targetSheet = getRequiredSheet_(DAILY_KPI_CFG.TARGET_SHEET);
      const found = dailyKpiFindTargetPhysicalRow_(targetSheet, period, station.hubName || hubName);
      if (!found) throw new Error('TARGET_ROW_NOT_FOUND');
      const oldRider = dailyKpiNumber_(found.values[2], found.values[2], 'NUMBER');
      const oldSorter = dailyKpiNumber_(found.values[3], found.values[3], 'NUMBER');
      const newRider = Number(hit.values[5]) > 0 ? Number(hit.values[5]) : oldRider;
      const newSorter = Number(hit.values[7]) > 0 ? Number(hit.values[7]) : oldSorter;
      const detail = 'Requester=' + normalizeEmail_(hit.values[8]) +
        ' | Rider ' + oldRider + '→' + newRider +
        ' | Sorter ' + oldSorter + '→' + newSorter;
      const log = dailyKpiWriteLog_('APPROVED', access.email, detail);
      targetSheet.getRange(found.row,1,1,5).setValues([[period, station.hubName, newRider, newSorter, log]]);
    }

    reqSheet.getRange(hit.row,11,1,4).setValues([[
      decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      access.email, now, cleanText_(note || '', 500)
    ]]);
    SpreadsheetApp.flush();
    removeChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);
    return { ok:true, requestId:requestId, status:decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedBy:access.email };
  });
}

function dailyKpiBuildScoredRowsWithContext_(period, hubCodes, forceRefresh, permission, targets, config, periodModel) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  permission = permission || getPermissionModel_(false);
  targets = targets || buildTargetProdModel_(false);
  config = config || resolveKpiConfig_(period, false);
  periodModel = periodModel || getDailyKpiPeriodModel_(period, forceRefresh === true);

  const allowed = makeHubSet_(hubCodes || []);
  return (periodModel.rows || []).filter(function(r) {
    return r.period === period && allowed[normalizeCompare_(r.hubCode)];
  }).map(function(base) {
    const station = stationByHubCode_(permission, base.hubCode);
    const target = station ? dailyKpiTargetByHub_(targets, period, station) : null;
    return dailyKpiScoreRow_(
      base,
      target,
      station || { hubName:base.hubName, type:'' },
      config
    );
  });
}

function dailyKpiBuildScoredRows_(period, hubCodes, forceRefresh) {
  return dailyKpiBuildScoredRowsWithContext_(
    period,
    hubCodes,
    forceRefresh === true,
    null,
    null,
    null,
    null
  );
}

function dailyKpiScopeGrade_(dayRows, selectedHubCodes) {
  const byHub = {};
  (dayRows || []).forEach(function(r){ byHub[normalizeCompare_(r.hubCode)] = r; });
  const required = (selectedHubCodes || []).map(normalizeCompare_);
  if (!required.length) return { grade:'', weightedScore:null, complete:false, validHubCount:0, requiredHubCount:0, totalVolume:0 };
  if (required.length === 1) {
    const row = byHub[required[0]];
    return {
      grade:row && row.grade || '', weightedScore:null,
      complete:!!(row && row.grade), validHubCount:row && row.grade ? 1 : 0,
      requiredHubCount:1, totalVolume:row && row.totalVolume || 0,
      singleHub:true, finalPointPct:row ? row.finalPointPct : null
    };
  }
  const items = [];
  let totalVolume = 0;
  for (let i = 0; i < required.length; i++) {
    const row = byHub[required[i]];
    if (!row || !row.grade || !(Number(row.totalVolume) > 0)) {
      return { grade:'', weightedScore:null, complete:false, validHubCount:items.length, requiredHubCount:required.length, totalVolume:totalVolume, singleHub:false };
    }
    items.push({ hubCode:row.hubCode, hubName:row.hubName, grade:row.grade, volume:Number(row.totalVolume) });
    totalVolume += Number(row.totalVolume);
  }
  const g = calculateMultiHubGrade_(items);
  return {
    grade:g && g.grade || '', weightedScore:g && g.weightedScore != null ? g.weightedScore : null,
    complete:!!(g && g.ok), validHubCount:items.length, requiredHubCount:required.length,
    totalVolume:totalVolume, singleHub:false
  };
}




function refreshDailyKpiCache() {
  const access = requireAccess_(['kpi']);
  clearDailyKpiCaches_();
  removeChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);
  removeChunkedCacheJson_(CACHE_CFG.KPI_CONFIG_MODEL_KEY);
  const meta = getDailyKpiMetaModel_(true);
  return {
    ok:true,
    refreshedBy:access.email,
    periods:meta.periods || [],
    sourceMeta:meta.sourceMeta || {},
    serverTime:new Date().toISOString()
  };
}

/* ============================================================
   DAILY KPI DIAGNOSTICS
   ============================================================ */
function debugDailyKpiSources() {
  const access = requireAccess_(['kpi']);
  const meta = getDailyKpiMetaModel_(true);
  const period = (meta.periods || [])[0] || dailyKpiCurrentPeriod_();
  const model = getDailyKpiPeriodModel_(period, true);
  return {
    ok:true,
    checkedBy:access.email,
    period:period,
    periods:meta.periods || [],
    dates:(model.dates || []).slice(0,10),
    sourceMeta:model.sourceMeta || meta.sourceMeta || {},
    normalizedRows:(model.rows || []).length,
    targetSheet:getDb_().getSheetByName(DAILY_KPI_CFG.TARGET_SHEET) ? DAILY_KPI_CFG.TARGET_SHEET : '',
    requestSheet:getDb_().getSheetByName(DAILY_KPI_CFG.REQUEST_SHEET) ? DAILY_KPI_CFG.REQUEST_SHEET : '',
    configSheet:getDb_().getSheetByName(DAILY_KPI_CFG.CONFIG_SHEET) ? DAILY_KPI_CFG.CONFIG_SHEET : '',
    config:resolveKpiConfig_(period, false)
  };
}


/* ============================================================
   V0.13.0 — MATERIALIZED FACT ENGINE
   ------------------------------------------------------------
   Core runtime principle:
     WEB REQUESTS NEVER SCAN / UNPIVOT THE 6 KPI RAW SHEETS.
     WEB REQUESTS NEVER REBUILD HISTORICAL FORECAST.

   Heavy work happens only in background ETL / explicit ADMIN rebuild:
     RAW SOURCES -> normalized RAW fact -> SCORED DAILY fact -> Cache -> UI
     Historical Forecast -> normalized FORECAST fact -> Cache -> UI

   Daily KPI runtime normally serves ScriptCache. If cache is evicted:
     - 1 HUB: reads only that HUB's contiguous rows from the scored fact sheet.
     - <= 8 HUBs: reads only those HUB blocks.
     - large scope: one batched read of the scored fact sheet.

   Target / KPI config writes do NOT rescan raw source sheets. They re-score
   the already materialized RAW fact in memory and refresh ScriptCache.
   The background ETL persists the refreshed score sheet afterwards.
   ============================================================ */


const DATA_REFRESH_CFG = Object.freeze({
  VERSION_PROP:'SPX_DATA_REFRESH_VERSION_V01716',
  AT_PROP:'SPX_DATA_REFRESH_AT_V01716',
  KPI_ROWS_PROP:'SPX_DATA_REFRESH_KPI_ROWS_V01716',
  DAILY_ROWS_PROP:'SPX_DATA_REFRESH_DAILY_ROWS_V01716',
  FORECAST_ROWS_PROP:'SPX_DATA_REFRESH_FORECAST_ROWS_V01717'
});

function publishDataRefreshVersion_(kpiRows, dailyRows, forecastRows) {
  const now = new Date();
  const version = Utilities.formatDate(
    now,
    FACT_ENGINE_CFG.FULL_REFRESH_TIMEZONE,
    'yyyyMMdd-HHmmss'
  );

  PropertiesService.getScriptProperties().setProperties({
    [DATA_REFRESH_CFG.VERSION_PROP]:version,
    [DATA_REFRESH_CFG.AT_PROP]:now.toISOString(),
    [DATA_REFRESH_CFG.KPI_ROWS_PROP]:String(Number(kpiRows || 0)),
    [DATA_REFRESH_CFG.DAILY_ROWS_PROP]:String(Number(dailyRows || 0)),
    [DATA_REFRESH_CFG.FORECAST_ROWS_PROP]:String(Number(forecastRows || 0))
  }, false);

  return {
    version:version,
    refreshedAt:now.toISOString()
  };
}

function getKpiDataRefreshState() {
  requireAccess_(['dashboard', 'kpi', 'd0', 'alerts', 'backlog', 'compensated']);
  const p = PropertiesService.getScriptProperties();

  return {
    ok:true,
    version:p.getProperty(DATA_REFRESH_CFG.VERSION_PROP) || '',
    refreshedAt:p.getProperty(DATA_REFRESH_CFG.AT_PROP) || '',
    kpiRows:Number(p.getProperty(DATA_REFRESH_CFG.KPI_ROWS_PROP) || 0),
    dailyRows:Number(p.getProperty(DATA_REFRESH_CFG.DAILY_ROWS_PROP) || 0),
    forecastRows:Number(p.getProperty(DATA_REFRESH_CFG.FORECAST_ROWS_PROP) || 0),
    schedule:FACT_ENGINE_CFG.FULL_REFRESH_HOURS.slice(),
    timezone:FACT_ENGINE_CFG.FULL_REFRESH_TIMEZONE,
    securityVersion:getSecurityVersion_()
  };
}


const FACT_ENGINE_CFG = Object.freeze({
  VERSION: 'v01716',
  RAW_PREFIX: '_SYS_KPI_RAW_',
  SCORE_PREFIX: '_SYS_KPI_DAILY_',
  RAW_STAGE_PREFIX: '_SYS_KPI_RAW_STAGE_',
  SCORE_STAGE_PREFIX: '_SYS_KPI_DAILY_STAGE_',
  FORECAST_SHEET: '_SYS_FORECAST_DAILY_FACT',
  ETL_STATE_SHEET: '_SYS_ETL_STATE',

  RAW_CACHE_PREFIX: 'spx:v160:kpi-raw',
  SCORE_CACHE_PREFIX: 'spx:v160:kpi-score',
  FORECAST_CACHE_KEY: 'spx:v160:forecast-fact',

  KPI_ETL_HANDLER: 'runCurrentKpiFactETL',
  FORECAST_ETL_HANDLER: 'runForecastFactETL',
  FULL_REFRESH_HANDLER: 'runScheduledPerformanceRefresh',
  FULL_REFRESH_TIMEZONE: 'Asia/Ho_Chi_Minh',
  FULL_REFRESH_HOURS: [7, 12, 18],

  // Manual KPI / Forecast ETL handlers are retained, but automatic data
  // refresh is centralized into 4 full refresh windows per day.
  KPI_ETL_MINUTES: 30,
  FORECAST_ETL_MINUTES: 30,

  SMALL_SCOPE_HUB_LIMIT: 8,
  WRITE_CHUNK_ROWS: 5000,

  SCORE_INDEX_PROP_PREFIX: 'SPX_FACT_INDEX_V160_',
  SCORE_META_PROP_PREFIX: 'SPX_FACT_META_V160_',
  RAW_META_PROP_PREFIX: 'SPX_RAW_META_V160_',
  FORECAST_META_PROP: 'SPX_FORECAST_FACT_META_V160',
  DIRTY_PROP_PREFIX: 'SPX_FACT_DIRTY_V160_'
});


const ENGINE_OBS_CFG = Object.freeze({
  INIT_STATE_PROP: 'SPX_ENGINE_INIT_STATE_V140',
  INIT_HISTORY_LIMIT: 24,
  HEAVY_WARM_HOURS: 6
});

function engineSafeDetail_(value) {
  if (value == null) return {};
  if (typeof value === 'string') return { message:value.slice(0,1200) };
  try {
    const json = JSON.stringify(value);
    return JSON.parse(json.length > 5000 ? json.slice(0,5000) : json);
  } catch (_) {
    return { message:String(value).slice(0,1200) };
  }
}

function getEngineInitState_() {
  return factJsonParse_(
    PropertiesService.getScriptProperties().getProperty(ENGINE_OBS_CFG.INIT_STATE_PROP),
    { status:'NOT_INITIALIZED', phase:'IDLE', history:[] }
  );
}

function writeEngineInitState_(state) {
  state = state || {};
  state.updatedAt = new Date().toISOString();
  try {
    PropertiesService.getScriptProperties().setProperty(
      ENGINE_OBS_CFG.INIT_STATE_PROP,
      JSON.stringify(state)
    );
  } catch (_) {}
  try {
    setRuntimeStatus_({
      engineInitStatus:state.status || '',
      engineInitPhase:state.phase || '',
      engineInitUpdatedAt:state.updatedAt || ''
    });
  } catch (_) {}
  return state;
}

function beginEngineInitialization_() {
  return writeEngineInitState_({
    runId:Utilities.getUuid(),
    status:'RUNNING',
    phase:'STARTING',
    startedAt:new Date().toISOString(),
    completedAt:'',
    history:[]
  });
}

function updateEngineInitState_(phase, status, detail) {
  const state = getEngineInitState_();
  state.phase = String(phase || state.phase || '');
  state.status = String(status || state.status || 'RUNNING');
  state.history = Array.isArray(state.history) ? state.history : [];
  const entry = {
    at:new Date().toISOString(),
    phase:state.phase,
    status:state.status,
    detail:engineSafeDetail_(detail)
  };
  state.history.push(entry);
  if (state.history.length > ENGINE_OBS_CFG.INIT_HISTORY_LIMIT) {
    state.history = state.history.slice(-ENGINE_OBS_CFG.INIT_HISTORY_LIMIT);
  }
  if (['READY','PARTIAL','ERROR'].indexOf(state.status) !== -1) {
    state.completedAt = entry.at;
  }
  writeEngineInitState_(state);
  console.log('[SPX ENGINE] ' + state.phase + ' • ' + state.status + ' • ' + JSON.stringify(entry.detail));
  return state;
}

function runEngineInitStep_(result, key, phase, fn) {
  updateEngineInitState_(phase, 'RUNNING', {});
  const started = Date.now();
  try {
    const value = fn();
    const item = { ok:true, ms:Date.now()-started, result:value };
    result[key] = item;
    updateEngineInitState_(phase, 'DONE', { ms:item.ms, result:value });
    return value;
  } catch (err) {
    const item = { ok:false, ms:Date.now()-started, error:String(err && err.message || err) };
    result[key] = item;
    updateEngineInitState_(phase, 'STEP_ERROR', item);
    return null;
  }
}

function getMaterializedTriggerStatus_() {
  const existing = ScriptApp.getProjectTriggers().map(function(t){
    return {
      handler:t.getHandlerFunction(),
      eventType:String(t.getEventType()),
      source:String(t.getTriggerSource()),
      uniqueId:t.getUniqueId()
    };
  });

  const scheduleLabel = FACT_ENGINE_CFG.FULL_REFRESH_HOURS
    .map(function(h){ return String(h).padStart(2,'0') + ':00'; })
    .join(' / ');

  const expected = [
    {
      handler:FACT_ENGINE_CFG.FULL_REFRESH_HANDLER,
      cadence:scheduleLabel + ' ICT',
      purpose:'KPI Result + KPI Daily + Historical Forecast refresh',
      expectedCount:FACT_ENGINE_CFG.FULL_REFRESH_HOURS.length
    }
  ];

  return expected.map(function(x){
    const hits = existing.filter(function(t){ return t.handler === x.handler; });
    return {
      handler:x.handler,
      cadence:x.cadence,
      purpose:x.purpose,
      installed:hits.length === x.expectedCount,
      count:hits.length,
      expectedCount:x.expectedCount,
      triggerIds:hits.map(function(h){ return h.uniqueId; })
    };
  });
}

function inspectPhysicalFactSheet_(name, expectedColumns) {
  const sh = getDb_().getSheetByName(name);
  if (!sh) return { name:name, exists:false, rows:0, columns:0, expectedColumns:Number(expectedColumns||0) };
  return {
    name:name,
    exists:true,
    rows:Math.max(0, sh.getLastRow()-1),
    columns:sh.getLastColumn(),
    expectedColumns:Number(expectedColumns||0)
  };
}

const DAILY_SCORE_FACT_HEADERS = Object.freeze([
  'Period','Date','Hub Code','Hub Name','Hub Type','Grade','Final Point %','Total Volume',
  '%FM Ontime','%LM Ontime','%Deli Success','%Correct SOP - PU',
  'Rider Actual','Rider Target','%Rider Productivity','Rider Raw %','Rider Capped',
  'Sorter Actual','Sorter Target','%Sorter Productivity','Sorter Raw %','Sorter Capped',
  'Complete','Missing JSON','Weights JSON','Contributions JSON','Config Version','Generated At'
]);

const DAILY_RAW_FACT_HEADERS = Object.freeze([
  'Period','Date','Hub Code','Hub Name','%FM Ontime','%LM Ontime','%Deli Success',
  'Rider Prod','Sorter Prod','%Correct SOP - PU','Total Volume','Generated At'
]);

const FORECAST_FACT_HEADERS = Object.freeze([
  'Date','Region','Province','Hub Code','Hub Name','Zone','District',
  'FM Forecast','FM Inbound','FM Difference Source','Pickup Done',
  'LM Forecast','LM Inbound','LM Difference Source','LM LH Arrived','LM SOC Transported','Generated At'
]);

function factPeriodSuffix_(period) {
  return String(period || '').replace(/[^0-9]/g, '_');
}

function dailyRawFactSheetName_(period) {
  return FACT_ENGINE_CFG.RAW_PREFIX + factPeriodSuffix_(period);
}

function dailyScoreFactSheetName_(period) {
  return FACT_ENGINE_CFG.SCORE_PREFIX + factPeriodSuffix_(period);
}

function dailyRawStageSheetName_(period) {
  return FACT_ENGINE_CFG.RAW_STAGE_PREFIX + factPeriodSuffix_(period);
}

function dailyScoreStageSheetName_(period) {
  return FACT_ENGINE_CFG.SCORE_STAGE_PREFIX + factPeriodSuffix_(period);
}

function dailyRawCacheKey_(period) {
  return FACT_ENGINE_CFG.RAW_CACHE_PREFIX + ':' + String(period || '');
}

function dailyScoreCacheKey_(period) {
  return FACT_ENGINE_CFG.SCORE_CACHE_PREFIX + ':' + String(period || '');
}

function factIndexPropKey_(period) {
  return FACT_ENGINE_CFG.SCORE_INDEX_PROP_PREFIX + factPeriodSuffix_(period);
}

function factMetaPropKey_(period) {
  return FACT_ENGINE_CFG.SCORE_META_PROP_PREFIX + factPeriodSuffix_(period);
}

function rawMetaPropKey_(period) {
  return FACT_ENGINE_CFG.RAW_META_PROP_PREFIX + factPeriodSuffix_(period);
}

function dirtyPropKey_(period) {
  return FACT_ENGINE_CFG.DIRTY_PROP_PREFIX + factPeriodSuffix_(period);
}

function factJsonParse_(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch (_) { return fallback; }
}

function factNum_(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

/**
 * Canonical date key used by every materialized fact.
 * Google Sheets may silently convert a string like 2026-08-22 into a Date
 * when setValues() writes it to a normally-formatted cell. Reading that cell
 * with getValues() then returns a Date object. Never String(dateObject), because
 * that produces "Sat Aug 22 2026 ..." and breaks lexical date sorting / D-1.
 */
function factDateKey_(value) {
  const tz = (typeof DAILY_KPI_CFG !== 'undefined' && DAILY_KPI_CFG.TIMEZONE)
    ? DAILY_KPI_CFG.TIMEZONE
    : ((typeof FORECAST_CFG !== 'undefined' && FORECAST_CFG.TIMEZONE) ? FORECAST_CFG.TIMEZONE : 'Asia/Ho_Chi_Minh');

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }

  const text = String(value == null ? '' : value).trim();
  if (!text) return '';

  let m = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s].*)?$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);

  m = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);

  // Repairs legacy fact cells already stored/read as JavaScript Date.toString().
  const d = new Date(text);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');

  return '';
}

function factDateEpoch_(value) {
  const key = factDateKey_(value);
  if (!key) return 0;
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : 0;
}

function factSortDateDesc_(a, b) {
  return factDateEpoch_(b) - factDateEpoch_(a);
}

function factDateLabel_(value) {
  const key = factDateKey_(value);
  return key ? forecastDateLabel_(key) : '';
}

function ensureFactSheet_(name, headers) {
  const ss = getDb_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  try { sh.hideSheet(); } catch (_) {}
  return sh;
}

function writeFactSheet_(name, headers, rows) {
  const sh = ensureFactSheet_(name, headers);
  const requiredRows = Math.max(2, rows.length + 1);
  if (sh.getMaxRows() < requiredRows) {
    sh.insertRowsAfter(sh.getMaxRows(), requiredRows - sh.getMaxRows());
  }

  // Background-only operation. One clear + chunked writes is significantly
  // cheaper than row-by-row mutations and keeps normal web requests read-only.
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);

  // IMPORTANT: force materialized Date columns to plain text before writing.
  // Otherwise Sheets auto-coerces 2026-08-22 into a Date object and a later
  // getValues() returns "Sat Aug 22...", breaking sort, latest-day and D-1.
  const dateIndexes = [];
  const periodIndexes = [];
  (headers || []).forEach(function(h, i) {
    const key = normalizeKpiHeader_(h);
    if (key === 'date') dateIndexes.push(i);
    if (key === 'period') periodIndexes.push(i);
  });

  const normalizedRows = (rows || []).map(function(row) {
    const out = row.slice();
    dateIndexes.forEach(function(i) {
      if (out[i] === '' || out[i] == null) return;
      const key = factDateKey_(out[i]);
      out[i] = key || String(out[i]);
    });
    periodIndexes.forEach(function(i) {
      if (out[i] !== '' && out[i] != null) out[i] = String(out[i]);
    });
    return out;
  });

  dateIndexes.concat(periodIndexes).forEach(function(i) {
    if (requiredRows > 1) sh.getRange(2, i + 1, requiredRows - 1, 1).setNumberFormat('@');
  });

  const chunk = FACT_ENGINE_CFG.WRITE_CHUNK_ROWS;
  for (let i = 0; i < normalizedRows.length; i += chunk) {
    const part = normalizedRows.slice(i, i + chunk);
    sh.getRange(i + 2, 1, part.length, headers.length).setValues(part);
  }
  try { sh.setFrozenRows(1); sh.hideSheet(); } catch (_) {}
  return sh;
}


/**
 * Writes a complete candidate fact to a hidden STAGE sheet first.
 * The LIVE fact is only touched after the STAGE write succeeds.
 *
 * This does not make Google Sheets transactional, but it prevents the most
 * common partial-build failure: source read / candidate write fails before the
 * live fact is modified.
 */
function writeFactStageThenLive_(stageName, liveName, headers, rows) {
  writeFactSheet_(stageName, headers, rows);

  const stage = getDb_().getSheetByName(stageName);
  const expectedRows = (rows || []).length;

  if (!stage || Math.max(0, stage.getLastRow() - 1) !== expectedRows) {
    throw new Error('FACT_STAGE_VALIDATION_FAILED: ' + stageName);
  }

  // Candidate is complete. Publish the same in-memory rowset to LIVE.
  writeFactSheet_(liveName, headers, rows);

  const live = getDb_().getSheetByName(liveName);
  if (!live || Math.max(0, live.getLastRow() - 1) !== expectedRows) {
    throw new Error('FACT_LIVE_VALIDATION_FAILED: ' + liveName);
  }

  return { stage:stageName, live:liveName, rows:expectedRows };
}

function ensureEtlStateSheet_() {
  const headers = ['Pipeline','Period','Status','Rows','Generated At','Source Generated At','Version','Detail'];
  const sh = ensureFactSheet_(FACT_ENGINE_CFG.ETL_STATE_SHEET, headers);
  if (!String(sh.getRange(1,1).getDisplayValue() || '').trim()) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

function setFactState_(pipeline, period, status, rowCount, generatedAt, sourceGeneratedAt, detail) {
  const sh = ensureEtlStateSheet_();
  const key1 = String(pipeline || '');
  const key2 = String(period || '');
  let targetRow = 0;
  if (sh.getLastRow() >= 2) {
    const values = sh.getRange(2,1,sh.getLastRow()-1,2).getDisplayValues();
    for (let i=0;i<values.length;i++) {
      if (String(values[i][0]) === key1 && String(values[i][1]) === key2) { targetRow = i + 2; break; }
    }
  }
  if (!targetRow) targetRow = sh.getLastRow() + 1;
  sh.getRange(targetRow,1,1,8).setValues([[
    key1,key2,String(status || ''),Number(rowCount || 0),
    generatedAt || new Date().toISOString(),sourceGeneratedAt || '',APP.VERSION,
    typeof detail === 'string' ? detail : JSON.stringify(detail || {})
  ]]);
}

function getFactStates_() {
  const ss = getDb_();
  const sh = ss.getSheetByName(FACT_ENGINE_CFG.ETL_STATE_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,8).getDisplayValues().map(function(r){
    return { pipeline:r[0], period:r[1], status:r[2], rows:Number(r[3]||0), generatedAt:r[4], sourceGeneratedAt:r[5], version:r[6], detail:factJsonParse_(r[7],{}) };
  });
}

function markDailyFactDirty_(period, reason) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const payload = { dirty:true, reason:String(reason || ''), at:new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty(dirtyPropKey_(period), JSON.stringify(payload));
  return payload;
}

function clearDailyFactDirty_(period) {
  try { PropertiesService.getScriptProperties().deleteProperty(dirtyPropKey_(period)); } catch (_) {}
}

function getDailyFactDirty_(period) {
  return factJsonParse_(PropertiesService.getScriptProperties().getProperty(dirtyPropKey_(period)), null);
}

/* ---------------- RAW KPI FACT ---------------- */

function persistDailyRawFact_(model) {
  const generatedAt = model.generatedAt || new Date().toISOString();

  const rows = (model.rows || []).map(function(r){
    const v = r.values || {};
    return [
      model.period,
      r.dateKey,
      r.hubCode,
      r.hubName,
      v.fmOntime == null ? '' : v.fmOntime,
      v.lmOntime == null ? '' : v.lmOntime,
      v.deliSuccess == null ? '' : v.deliSuccess,
      v.riderProductivity == null ? '' : v.riderProductivity,
      v.sorterProductivity == null ? '' : v.sorterProductivity,
      v.correctSopPu == null ? '' : v.correctSopPu,
      r.totalVolume == null ? '' : r.totalVolume,
      generatedAt
    ];
  });

  writeFactStageThenLive_(
    dailyRawStageSheetName_(model.period),
    dailyRawFactSheetName_(model.period),
    DAILY_RAW_FACT_HEADERS,
    rows
  );

  const validation = model.validation || dailyKpiValidatePeriodModel_(model);
  const meta = {
    period:model.period,
    generatedAt:generatedAt,
    rows:rows.length,
    readMode:'ALL_SHEET',
    sourceMeta:model.sourceMeta || {},
    dates:model.dates || [],
    validation:validation
  };

  PropertiesService.getScriptProperties().setProperty(
    rawMetaPropKey_(model.period),
    JSON.stringify(meta)
  );

  putChunkedCacheJson_(
    dailyRawCacheKey_(model.period),
    model,
    CACHE_CFG.DAILY_KPI_TTL_SEC
  );

  setFactState_(
    'KPI_RAW',
    model.period,
    validation.status || 'READY',
    rows.length,
    generatedAt,
    generatedAt,
    {
      readMode:'ALL_SHEET',
      sourceMeta:model.sourceMeta || {},
      validation:validation
    }
  );

  return meta;
}

function readDailyRawFact_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const cached = getChunkedCacheJson_(dailyRawCacheKey_(period));
  if (cached) return cached;
  const sh = getDb_().getSheetByName(dailyRawFactSheetName_(period));
  if (!sh || sh.getLastRow() < 2) return null;
  const values = sh.getRange(2,1,sh.getLastRow()-1,DAILY_RAW_FACT_HEADERS.length).getValues();
  const rows = [];
  const dates = {};
  values.forEach(function(r){
    const dateKey = factDateKey_(r[1]);
    const hubCode = String(r[2] || '').trim();
    if (!dateKey || !hubCode) return;
    rows.push({
      period:String(r[0] || period), dateKey:dateKey, hubCode:hubCode, hubName:String(r[3] || ''),
      values:{ fmOntime:factNum_(r[4]), lmOntime:factNum_(r[5]), deliSuccess:factNum_(r[6]), riderProductivity:factNum_(r[7]), sorterProductivity:factNum_(r[8]), correctSopPu:factNum_(r[9]) },
      totalVolume:factNum_(r[10]), duplicateCounts:{}
    });
    dates[dateKey] = true;
  });
  const meta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(rawMetaPropKey_(period)), {});
  const model = { generatedAt:meta.generatedAt || String(values[0] && values[0][11] || ''), materialized:true, period:period, readMode:meta.readMode || 'ALL_SHEET', dates:Object.keys(dates).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_), sourceMeta:meta.sourceMeta || {}, validation:meta.validation || {}, rows:rows };
  putChunkedCacheJson_(dailyRawCacheKey_(period), model, CACHE_CFG.DAILY_KPI_TTL_SEC);
  return model;
}

/* ---------------- SCORED DAILY KPI FACT ---------------- */

function buildScoredDailyFactFromRaw_(period, rawModel) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  rawModel = rawModel || readDailyRawFact_(period);
  if (!rawModel) return null;

  const permission = getPermissionModel_(false);
  const targets = buildTargetProdModel_(false);
  const config = resolveKpiConfig_(period, false);
  const stationMap = {};
  (permission.stations || []).forEach(function(s){ stationMap[normalizeCompare_(s.hubCode)] = s; });

  const rows = (rawModel.rows || []).map(function(base){
    const station = stationMap[normalizeCompare_(base.hubCode)] || { hubName:base.hubName, hubCode:base.hubCode, type:'' };
    const target = dailyKpiTargetByHub_(targets, period, station);
    return dailyKpiScoreRow_(base, target, station, config);
  }).sort(function(a,b){
    return normalizeCompare_(a.hubCode).localeCompare(normalizeCompare_(b.hubCode)) || b.dateKey.localeCompare(a.dateKey);
  });

  const dates = {};
  rows.forEach(function(r){ dates[r.dateKey] = true; });
  return {
    ready:true, materialized:true, period:period,
    generatedAt:new Date().toISOString(), rawGeneratedAt:rawModel.generatedAt || '',
    configVersion:config.version || 0, configSource:config.source || 'DEFAULT_FALLBACK',
    weights:config.weights || {}, grades:config.grades || [], sourceMeta:rawModel.sourceMeta || {},
    readMode:rawModel.readMode || 'ALL_SHEET', validation:rawModel.validation || {},
    dates:Object.keys(dates).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_), rows:rows
  };
}

function scoredFactRowValues_(r, model) {
  return [
    model.period,r.dateKey,r.hubCode,r.hubName,r.hubType || '',r.grade || '',
    r.finalPointPct == null ? '' : r.finalPointPct,
    r.totalVolume == null ? '' : r.totalVolume,
    r.fmOntime == null ? '' : r.fmOntime,
    r.lmOntime == null ? '' : r.lmOntime,
    r.deliSuccess == null ? '' : r.deliSuccess,
    r.correctSopPu == null ? '' : r.correctSopPu,
    r.riderActual == null ? '' : r.riderActual,
    r.riderTarget == null ? '' : r.riderTarget,
    r.riderProductivityPct == null ? '' : Math.min(120, Math.max(0, Number(r.riderProductivityPct))),
    r.riderProductivityRawPct == null ? '' : r.riderProductivityRawPct,
    Boolean(r.riderProductivityCapped),
    r.sorterActual == null ? '' : r.sorterActual,
    r.sorterTarget == null ? '' : r.sorterTarget,
    r.sorterProductivityPct == null ? '' : Math.min(120, Math.max(0, Number(r.sorterProductivityPct))),
    r.sorterProductivityRawPct == null ? '' : r.sorterProductivityRawPct,
    Boolean(r.sorterProductivityCapped),
    Boolean(r.complete),JSON.stringify(r.missing || []),JSON.stringify(r.weights || {}),JSON.stringify(r.contributions || {}),
    Number(model.configVersion || 0),model.generatedAt || new Date().toISOString()
  ];
}

function persistDailyScoredFact_(model) {
  if (!model || !model.period) return null;

  const rows = (model.rows || []).map(function(r){
    return scoredFactRowValues_(r, model);
  });

  writeFactStageThenLive_(
    dailyScoreStageSheetName_(model.period),
    dailyScoreFactSheetName_(model.period),
    DAILY_SCORE_FACT_HEADERS,
    rows
  );

  // Rows are sorted by Hub Code then Date. Persist a row index so a
  // single-HUB request reads only that HUB block from the materialized fact.
  const index = {};
  rows.forEach(function(r, i){
    const code = String(r[2] || '');
    if (!code) return;
    if (!index[code]) index[code] = { startRow:i + 2, count:0 };
    index[code].count += 1;
  });

  const props = PropertiesService.getScriptProperties();
  props.setProperty(factIndexPropKey_(model.period), JSON.stringify(index));

  const validation = model.validation || {};
  props.setProperty(factMetaPropKey_(model.period), JSON.stringify({
    period:model.period,
    generatedAt:model.generatedAt,
    rawGeneratedAt:model.rawGeneratedAt || '',
    rows:rows.length,
    readMode:model.readMode || 'ALL_SHEET',
    configVersion:model.configVersion || 0,
    configSource:model.configSource || '',
    sourceMeta:model.sourceMeta || {},
    validation:validation,
    dates:model.dates || []
  }));

  putChunkedCacheJson_(
    dailyScoreCacheKey_(model.period),
    model,
    CACHE_CFG.DAILY_KPI_TTL_SEC
  );

  clearDailyFactDirty_(model.period);

  setFactState_(
    'KPI_SCORE',
    model.period,
    validation.status || 'READY',
    rows.length,
    model.generatedAt,
    model.rawGeneratedAt || '',
    {
      configVersion:model.configVersion || 0,
      readMode:model.readMode || 'ALL_SHEET',
      validation:validation
    }
  );

  return {
    period:model.period,
    rows:rows.length,
    generatedAt:model.generatedAt,
    readMode:model.readMode || 'ALL_SHEET',
    validation:validation
  };
}

function parseDailyScoredFactRows_(values) {
  return (values || []).map(function(r){
    return {
      dateKey:factDateKey_(r[1]), dateLabel:factDateLabel_(r[1]),
      hubCode:String(r[2] || ''), hubName:String(r[3] || ''), hubType:String(r[4] || ''), grade:String(r[5] || ''),
      finalPointPct:factNum_(r[6]), finalPoint:factNum_(r[6]) == null ? null : Number(r[6]) / 100,
      totalVolume:factNum_(r[7]),
      fmOntime:factNum_(r[8]), lmOntime:factNum_(r[9]), deliSuccess:factNum_(r[10]), correctSopPu:factNum_(r[11]),
      riderActual:factNum_(r[12]), riderTarget:factNum_(r[13]), riderProductivityPct:factNum_(r[14]), riderProductivityRawPct:factNum_(r[15]), riderProductivityCapped:toBool_(r[16]),
      sorterActual:factNum_(r[17]), sorterTarget:factNum_(r[18]), sorterProductivityPct:factNum_(r[19]), sorterProductivityRawPct:factNum_(r[20]), sorterProductivityCapped:toBool_(r[21]),
      complete:toBool_(r[22]), missing:factJsonParse_(r[23],[]), weights:factJsonParse_(r[24],{}), contributions:factJsonParse_(r[25],{}), configVersion:Number(r[26] || 0)
    };
  }).filter(function(r){ return r.dateKey && r.hubCode; });
}

function readDailyScoredFullFact_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const cached = getChunkedCacheJson_(dailyScoreCacheKey_(period));
  if (cached) return cached;
  const sh = getDb_().getSheetByName(dailyScoreFactSheetName_(period));
  if (!sh || sh.getLastRow() < 2) return null;
  const values = sh.getRange(2,1,sh.getLastRow()-1,DAILY_SCORE_FACT_HEADERS.length).getValues();
  const meta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(factMetaPropKey_(period)), {});
  const rows = parseDailyScoredFactRows_(values);
  const model = { ready:true, materialized:true, period:period, generatedAt:meta.generatedAt || '', rawGeneratedAt:meta.rawGeneratedAt || '', readMode:meta.readMode || 'ALL_SHEET', validation:meta.validation || {}, configVersion:Number(meta.configVersion || 0), configSource:meta.configSource || '', sourceMeta:meta.sourceMeta || {}, dates:meta.dates || [], rows:rows };
  putChunkedCacheJson_(dailyScoreCacheKey_(period), model, CACHE_CFG.DAILY_KPI_TTL_SEC);
  return model;
}

function readDailyScoredSlice_(period, hubCodes, forceReload) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const key = dailyScoreCacheKey_(period);
  if (forceReload === true) removeChunkedCacheJson_(key);
  const cached = getChunkedCacheJson_(key);
  const allowed = makeHubSet_(hubCodes || []);
  if (cached) {
    return Object.assign({}, cached, { rows:(cached.rows || []).filter(function(r){ return allowed[normalizeCompare_(r.hubCode)]; }) });
  }

  const sh = getDb_().getSheetByName(dailyScoreFactSheetName_(period));
  if (!sh || sh.getLastRow() < 2) return null;
  const index = factJsonParse_(PropertiesService.getScriptProperties().getProperty(factIndexPropKey_(period)), {});
  const requested = (hubCodes || []).filter(Boolean);
  let rows = [];

  if (requested.length > 0 && requested.length <= FACT_ENGINE_CFG.SMALL_SCOPE_HUB_LIMIT && Object.keys(index).length) {
    requested.forEach(function(code){
      const hit = index[code] || index[Object.keys(index).find(function(k){ return normalizeCompare_(k) === normalizeCompare_(code); })];
      if (!hit || !(hit.count > 0)) return;
      const values = sh.getRange(Number(hit.startRow),1,Number(hit.count),DAILY_SCORE_FACT_HEADERS.length).getValues();
      rows = rows.concat(parseDailyScoredFactRows_(values));
    });
  } else {
    const values = sh.getRange(2,1,sh.getLastRow()-1,DAILY_SCORE_FACT_HEADERS.length).getValues();
    const allRows = parseDailyScoredFactRows_(values);
    rows = allRows.filter(function(r){ return allowed[normalizeCompare_(r.hubCode)]; });
    // Large-scope read already paid the cost; cache full period for the next users.
    const metaAll = factJsonParse_(PropertiesService.getScriptProperties().getProperty(factMetaPropKey_(period)), {});
    putChunkedCacheJson_(key, { ready:true, materialized:true, period:period, generatedAt:metaAll.generatedAt || '', rawGeneratedAt:metaAll.rawGeneratedAt || '', readMode:metaAll.readMode || 'ALL_SHEET', validation:metaAll.validation || {}, configVersion:Number(metaAll.configVersion || 0), configSource:metaAll.configSource || '', sourceMeta:metaAll.sourceMeta || {}, dates:metaAll.dates || [], rows:allRows }, CACHE_CFG.DAILY_KPI_TTL_SEC);
  }

  const meta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(factMetaPropKey_(period)), {});
  return { ready:true, materialized:true, period:period, generatedAt:meta.generatedAt || '', rawGeneratedAt:meta.rawGeneratedAt || '', readMode:meta.readMode || 'ALL_SHEET', validation:meta.validation || {}, configVersion:Number(meta.configVersion || 0), configSource:meta.configSource || '', sourceMeta:meta.sourceMeta || {}, dates:meta.dates || [], rows:rows };
}

function refreshScoredDailyCacheFromRaw_(period, reason) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const raw = readDailyRawFact_(period);
  if (!raw) {
    markDailyFactDirty_(period, reason || 'RAW_FACT_NOT_READY');
    return { ok:false, ready:false, reason:'RAW_FACT_NOT_READY' };
  }
  const scored = buildScoredDailyFactFromRaw_(period, raw);
  if (!scored) return { ok:false, ready:false };
  putChunkedCacheJson_(dailyScoreCacheKey_(period), scored, CACHE_CFG.DAILY_KPI_TTL_SEC);
  markDailyFactDirty_(period, reason || 'RESCORE_CACHE_ONLY');
  setFactState_('KPI_SCORE', period, 'CACHE_FRESH_PERSIST_PENDING', (scored.rows || []).length, scored.generatedAt, scored.rawGeneratedAt || '', { reason:reason || '' });
  return { ok:true, ready:true, rows:(scored.rows || []).length, generatedAt:scored.generatedAt };
}

/* ---------------- FORECAST FACT ---------------- */

function persistForecastFact_(model) {
  model = model || {};
  const generatedAt = model.generatedAt || new Date().toISOString();
  const parsed = model.rows || [];
  const matched = parsed.filter(function(r){ return !!r.hubCode; });
  const unmatched = parsed.filter(function(r){ return !r.hubCode; });
  const matchedHubSet = {};
  matched.forEach(function(r){ matchedHubSet[normalizeCompare_(r.hubCode)] = true; });

  const rows = matched.map(function(r){
    return [r.dateKey,r.region || '',r.province || '',r.hubCode || '',r.hubName || '',r.zone || '',r.district || '',
      r.fmForecast || 0,r.fmInbound || 0,r.fmDifferenceSource == null ? '' : r.fmDifferenceSource,r.pickupDone || 0,
      r.lmForecast || 0,r.lmInbound || 0,r.lmDifferenceSource == null ? '' : r.lmDifferenceSource,r.lmLhArrived || 0,r.lmSocTransported || 0,generatedAt];
  });

  // Always write, even when zero matches, so a stale old fact can never survive a failed rebuild.
  writeFactSheet_(FACT_ENGINE_CFG.FORECAST_SHEET, FORECAST_FACT_HEADERS, rows);

  const meta = {
    generatedAt:generatedAt,
    rows:rows.length,
    sourceRows:Number(model.sourceRows || parsed.length || 0),
    parsedRows:Number(model.parsedRows || parsed.length || 0),
    matchedRows:matched.length,
    unmatchedRows:unmatched.length,
    matchedHubCount:Object.keys(matchedHubSet).length,
    unmatchedSample:unmatched.slice(0,30).map(function(r){ return r.sourceHubName || r.hubName || ''; }),
    dates:model.dates || [],
    sheetName:model.sheetName || FORECAST_CFG.SHEET_NAME,
    headerRow:model.headerRow || 1
  };
  PropertiesService.getScriptProperties().setProperty(FACT_ENGINE_CFG.FORECAST_META_PROP, JSON.stringify(meta));
  removeChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY);
  const factModel = readForecastFactFromRows_(rows, meta);
  putChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY, factModel, CACHE_CFG.FORECAST_TTL_SEC);

  const state = matched.length === 0 && meta.sourceRows > 0
    ? 'ERROR'
    : (unmatched.length > 0 ? 'READY_WITH_WARNINGS' : 'READY');
  setFactState_('FORECAST', '', state, rows.length, generatedAt, generatedAt, meta);

  if (matched.length === 0 && meta.sourceRows > 0) {
    throw new Error('FORECAST_NO_HUB_MATCHES: Historical Forecast has ' + meta.sourceRows + ' source rows but 0 rows matched Permission Hub Name. Run debugForecastMaterialization().');
  }
  return meta;
}


function readForecastFactFromRows_(values, meta) {
  const rows = (values || []).map(function(r, i){
    return { rowNumber:i+2,dateKey:factDateKey_(r[0]),region:String(r[1] || ''),province:String(r[2] || ''),sourceHubName:String(r[4] || ''),hubCode:String(r[3] || ''),hubName:String(r[4] || ''),zone:String(r[5] || ''),district:String(r[6] || ''),fmForecast:Number(r[7] || 0),fmInbound:Number(r[8] || 0),fmDifferenceSource:factNum_(r[9]),pickupDone:Number(r[10] || 0),lmForecast:Number(r[11] || 0),lmInbound:Number(r[12] || 0),lmDifferenceSource:factNum_(r[13]),lmLhArrived:Number(r[14] || 0),lmSocTransported:Number(r[15] || 0) };
  }).filter(function(r){ return r.dateKey && r.hubCode; });
  const dates = {};
  rows.forEach(function(r){ dates[r.dateKey] = true; });
  return { sheetFound:true, materialized:true, sheetName:(meta && meta.sheetName) || FORECAST_CFG.SHEET_NAME, generatedAt:(meta && meta.generatedAt) || '', headerRow:(meta && meta.headerRow) || 1, dates:(meta && meta.dates && meta.dates.length ? meta.dates.map(factDateKey_).filter(Boolean).sort(factSortDateDesc_) : Object.keys(dates).map(factDateKey_).filter(Boolean).sort(factSortDateDesc_)), rows:rows };
}

function readForecastFact_() {
  const cached = getChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY);
  if (cached) return cached;
  const sh = getDb_().getSheetByName(FACT_ENGINE_CFG.FORECAST_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const values = sh.getRange(2,1,sh.getLastRow()-1,FORECAST_FACT_HEADERS.length).getValues();
  const meta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(FACT_ENGINE_CFG.FORECAST_META_PROP), {});
  const model = readForecastFactFromRows_(values, meta);
  putChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY, model, CACHE_CFG.FORECAST_TTL_SEC);
  return model;
}

/* ---------------- RUNTIME OVERRIDES ---------------- */

function getForecastModel_(forceRefresh) {
  if (forceRefresh === true) removeChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY);
  const model = readForecastFact_();
  if (model) return model;
  // Never scan Historical Forecast on a user request.
  return { sheetFound:false, dataReady:false, materialized:true, sheetName:FORECAST_CFG.SHEET_NAME, generatedAt:'', headerRow:1, dates:[], rows:[] };
}

function getDailyKpiMeta(forceRefresh) {
  requireAccess_(['kpi']);

  const meta =
    getMergedDailyKpiMeta_(
      forceRefresh === true
    );

  const current =
    dailyKpiCurrentPeriod_();

  const periods =
    meta &&
    Array.isArray(meta.periods)
      ? meta.periods.slice()
      : [];

  if (
    periods.indexOf(current) === -1
  ) {
    periods.unshift(current);
  }

  return {
    ok:true,

    periods:
      periods.map(function(p) {
        return {
          value:p,
          label:
            dailyKpiPeriodLabel_(p)
        };
      }),

    defaultPeriod:
      periods.indexOf(current) !== -1
        ? current
        : (periods[0] || current),

    currentPeriod:
      current,

    sourceMeta:
      meta
        ? meta.sourceMeta || {}
        : {},

    generatedAt:
      meta
        ? meta.generatedAt || ''
        : '',

    buildId:
      meta
        ? meta.buildId || ''
        : '',

    // Keep the original response contract for the unchanged frontend.
    sheetName:
      MERGED_DAILY_KPI_CFG.SHEET_NAME,

    runtimeSource:
      'KPI Daily',

    materialized:true,
    merged:true
  };
}

function getDailyKpiPerformance(
  path,
  period,
  selectedHubCodes,
  forceRefresh
) {
  const access =
    requireAccess_(['kpi']);

  const resolved =
    assertDrillPathAccess_(
      access,
      path || {}
    );

  const hubCodes =
    resolveSelectedAuthorizedHubCodes_(
      resolved.view,
      selectedHubCodes
    );

  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  // Direct KPI Daily source.
  // Only day summary data is prepared here; HUB rows load on expand.
  const direct =
    getKpiDailyDirectDayList_(
      period,
      hubCodes,
      forceRefresh === true
    );

  // KEEP ORIGINAL TARGET KPI SETUP / REQUEST LOGIC.
  const permission =
    getPermissionModel_(false);

  const config =
    resolveKpiConfig_(
      period,
      false
    );

  const targetStatus =
    getTargetProdStatusInternal_(
      access,
      resolved,
      period,
      hubCodes,
      false,
      permission,
      config
    );

  if (!direct) {
    return {
      ok:true,
      dataReady:false,
      materialized:true,

      period:period,
      periodLabel:
        dailyKpiPeriodLabel_(period),

      selectedHubCodes:
        hubCodes,

      selectedHubCount:
        hubCodes.length,

      sourceMeta:
        (
          getMergedDailyKpiMeta_(
            false
          ) || {}
        ).sourceMeta || {},

      dates:[],
      days:[],

      targetStatus:
        targetStatus,

      scoring:{
        configVersion:
          config.version || 0,

        configSource:
          config.source ||
          'DEFAULT_FALLBACK',

        weights:
          config.weights,

        grades:
          config.grades,

        productivityCapPct:120
      },

      freshness:{
        status:'NOT_READY',
        dirty:false
      },

      serverTime:
        new Date().toISOString()
    };
  }

  const singleHub =
    hubCodes.length === 1;

  const days =
    (direct.days || [])
      .map(function(day) {
        // NO KPI calculation here.
        // Single HUB: show source result.
        // Multi HUB: frontend can expand the date and see each source HUB row.
        return {
          dateKey:
            day.dateKey,

          dateLabel:
            day.dateLabel,

          grade:
            singleHub
              ? day.grade || ''
              : '',

          weightedScore:null,

          gradeComplete:
            singleHub
              ? Boolean(day.grade)
              : Number(
                  day.completeHubCount || 0
                ) === hubCodes.length,

          completeHubCount:
            Number(
              day.completeHubCount || 0
            ),

          totalHubCount:
            hubCodes.length,

          totalVolume:null,

          singleHub:
            singleHub,

          hubType:
            singleHub
              ? day.hubType || ''
              : '',

          finalPointPct:
            singleHub
              ? day.finalPointPct
              : null,

          fmOntime:
            singleHub
              ? day.fmOntime
              : null,

          lmOntime:
            singleHub
              ? day.lmOntime
              : null,

          deliSuccess:
            singleHub
              ? day.deliSuccess
              : null,

          // IMPORTANT:
          // source value is passed through exactly.
          // No Math.min(120, ...).
          sorterProductivityPct:
            singleHub
              ? day.sorterProductivityPct
              : null,

          riderProductivityPct:
            singleHub
              ? day.riderProductivityPct
              : null,

          correctSopPu:
            singleHub
              ? day.correctSopPu
              : null,

          weights:null,
          contributions:null,
          missing:[]
        };
      });

  return {
    ok:true,
    dataReady:true,
    materialized:true,

    period:period,
    periodLabel:
      dailyKpiPeriodLabel_(period),

    selectedHubCodes:
      hubCodes,

    selectedHubCount:
      hubCodes.length,

    sourceMeta:
      direct.sourceMeta || {},

    dates:
      days.map(function(day) {
        return day.dateKey;
      }),

    days:days,

    // KEEP target data contract exactly for the existing frontend.
    targetStatus:
      targetStatus,

    // KEEP config contract exactly so Target KPI / Settings frontend is unchanged.
    // These settings are not used to re-score KPI Daily in this function.
    scoring:{
      configVersion:
        config.version || 0,

      configSource:
        config.source ||
        'DEFAULT_FALLBACK',

      weights:
        config.weights,

      grades:
        config.grades,

      productivityCapPct:120,

      note:
        'Daily KPI values are read directly from KPI Daily. Existing target/config UI contract is preserved.'
    },

    freshness:{
      status:'READY',
      generatedAt:
        direct.generatedAt || '',
      rawGeneratedAt:'',
      dirty:false
    },

    serverTime:
      new Date().toISOString()
  };
}

function getDailyKpiDayDetail(
  path,
  period,
  dateKey,
  selectedHubCodes,
  forceRefresh
) {
  const access =
    requireAccess_(['kpi']);

  const resolved =
    assertDrillPathAccess_(
      access,
      path || {}
    );

  const hubCodes =
    resolveSelectedAuthorizedHubCodes_(
      resolved.view,
      selectedHubCodes
    );

  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  dateKey =
    String(dateKey || '').trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) ||
    dateKey.slice(0, 7) !== period
  ) {
    throw new Error(
      'DAILY_KPI_DATE_INVALID'
    );
  }

  // Read ONLY the expanded day.
  const direct =
    getKpiDailyDirectDaySlice_(
      period,
      dateKey,
      hubCodes,
      forceRefresh === true
    );

  const permission =
    getPermissionModel_(false);

  const existing = {};

  if (direct) {
    (direct.rows || [])
      .forEach(function(row) {
        existing[
          normalizeCompare_(
            row.hubCode
          )
        ] = row;
      });
  }

  // Build detail from authorized Permission HUB list.
  // Missing source HUB stays visible with blank KPI values.
  const rows =
    hubCodes.map(function(code) {
      const key =
        normalizeCompare_(code);

      if (existing[key]) {
        return existing[key];
      }

      const station =
        extendedStationByHubCode_(
          permission,
          code
        ) ||
        stationByHubCode_(
          permission,
          code
        ) || {
          hubCode:code,
          hubName:code,
          type:'',
          zone:''
        };

      return {
        period:period,
        dateKey:dateKey,
        dateLabel:
          forecastDateLabel_(dateKey),

        hubCode:
          station.hubCode || code,

        hubName:
          station.hubName || code,

        hubType:
          station.type || '',

        grade:'',
        finalPointPct:null,
        totalVolume:null,

        fmOntime:null,
        lmOntime:null,
        deliSuccess:null,

        sorterProductivityPct:null,
        riderProductivityPct:null,
        correctSopPu:null,

        sorterActual:null,
        sorterTarget:null,
        riderActual:null,
        riderTarget:null,

        complete:false,
        sourceMissing:true
      };
    }).sort(function(a, b) {
      return String(a.hubName || '')
        .localeCompare(
          String(b.hubName || '')
        );
    });

  return {
    ok:true,
    dataReady:!!direct,
    materialized:true,

    period:period,
    dateKey:dateKey,

    dateLabel:
      forecastDateLabel_(dateKey),

    rows:rows,

    // No multi-HUB grade calculation.
    scopeGrade:{
      grade:'',
      weightedScore:null,
      complete:false,
      validHubCount:
        rows.filter(function(r) {
          return r.complete === true;
        }).length,
      requiredHubCount:
        hubCodes.length,
      totalVolume:0,
      singleHub:
        hubCodes.length === 1
    },

    selectedHubCount:
      hubCodes.length,

    configVersion:0,

    serverTime:
      new Date().toISOString()
  };
}

/**
 * One-time migration/repair for V0.14.0 facts whose Date cells were auto-cast
 * by Google Sheets. Rebuilds current KPI + Forecast facts and warms clean V141
 * caches. Run manually once after deploying V0.14.1.
 */
function repairMaterializedDatesV141() {
  const admin = requireAdmin_();
  const started = Date.now();
  const period = dailyKpiCurrentPeriod_();
  console.log('[V141] Repair started for ' + period + ' by ' + admin.email);

  const kpi = materializeDailyKpiPeriod_(period);
  const forecast = materializeForecastFact_();
  const warm = warmFastRuntimeCaches();

  const result = {
    ok:true,
    version:APP.VERSION,
    period:period,
    kpi:kpi,
    forecast:forecast,
    warm:warm,
    ms:Date.now()-started,
    repairedAt:new Date().toISOString()
  };
  console.log(JSON.stringify(result,null,2));
  return result;
}

function debugDateIntegrityV141() {
  requireAdmin_();
  const period = dailyKpiCurrentPeriod_();
  const daily = readDailyScoredFullFact_(period);
  const forecast = readForecastFact_();
  function inspect(rows) {
    const sample=(rows||[]).slice(0,40).map(function(r){return r.dateKey;});
    const bad=sample.filter(function(x){return !/^\d{4}-\d{2}-\d{2}$/.test(String(x||''));});
    return { rows:(rows||[]).length, sample:sample.slice(0,10), badSample:bad.slice(0,10) };
  }
  const result={ version:APP.VERSION, daily:inspect(daily&&daily.rows), forecast:inspect(forecast&&forecast.rows) };
  console.log(JSON.stringify(result,null,2));
  return result;
}

function debugDailyKpiHubV141(hubCodeOrName, period) {
  requireAdmin_();
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const permission = getPermissionModel_(false);
  const key = normalizeCompare_(hubCodeOrName || '');
  const station = (permission.stations || []).find(function(s){
    return normalizeCompare_(s.hubCode) === key || normalizeStationName_(s.hubName) === normalizeStationName_(hubCodeOrName || '');
  });
  if (!station) throw new Error('HUB_NOT_FOUND: ' + String(hubCodeOrName || ''));
  const fact = readDailyScoredFullFact_(period);
  const rows = fact ? (fact.rows || []).filter(function(r){ return normalizeCompare_(r.hubCode) === normalizeCompare_(station.hubCode); }) : [];
  rows.sort(function(a,b){ return factSortDateDesc_(a.dateKey,b.dateKey); });
  const result = {
    period:period,
    hubCode:station.hubCode,
    hubName:station.hubName,
    rows:rows.map(function(r){ return {
      date:r.dateKey,
      grade:r.grade || '',
      finalPointPct:r.finalPointPct,
      rider:{ actual:r.riderActual, target:r.riderTarget, pct:r.riderProductivityPct, rawPct:r.riderProductivityRawPct, capped:r.riderProductivityCapped },
      sorter:{ actual:r.sorterActual, target:r.sorterTarget, pct:r.sorterProductivityPct, rawPct:r.sorterProductivityRawPct, capped:r.sorterProductivityCapped },
      missing:r.missing || []
    }; })
  };
  console.log(JSON.stringify(result,null,2));
  return result;
}

/* ---------------- BACKGROUND ETL ---------------- */

function materializeDailyKpiPeriod_(period) {
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const t0 = Date.now();

  setFactState_(
    'KPI_RAW',
    period,
    'RUNNING',
    0,
    new Date().toISOString(),
    '',
    { readMode:'ALL_SHEET' }
  );

  // 1) Read ALL 6 source sheets completely.
  const raw = buildDailyKpiPeriodModel_(period);

  // Target Prod KPI is an external authoritative source. Always invalidate
  // target cache before scoring a scheduled/materialized KPI build so the
  // current-period official target is picked up on the 4 daily refreshes.
  removeChunkedCacheJson_(CACHE_CFG.TARGET_PROD_MODEL_KEY);

  // 2) Score fully in memory BEFORE publishing live facts.
  const scored = buildScoredDailyFactFromRaw_(period, raw);
  if (!scored) throw new Error('KPI_SCORE_BUILD_FAILED');

  // 3) Candidate -> LIVE publish.
  const rawMeta = persistDailyRawFact_(raw);
  const scoreMeta = persistDailyScoredFact_(scored);

  const sourceCoverage = {};
  Object.keys(raw.sourceMeta || {}).forEach(function(k) {
    const m = raw.sourceMeta[k] || {};
    sourceCoverage[k] = {
      sheetName:m.sheetName || '',
      readMode:m.readMode || 'ALL_SHEET',
      physicalRows:Number(m.physicalRows || 0),
      periodRows:Number(m.periodRows || 0),
      hubCount:Number(m.hubCount || 0),
      dateCount:Number(m.dateCount || 0),
      minDate:m.minDate || '',
      maxDate:m.maxDate || ''
    };
  });

  const result = {
    ok:true,
    period:period,
    readMode:'ALL_SHEET',
    rawRows:(raw.rows || []).length,
    scoreRows:(scored.rows || []).length,
    validation:raw.validation || {},
    sourceCoverage:sourceCoverage,
    rawMeta:rawMeta,
    scoreMeta:scoreMeta,
    ms:Date.now() - t0,
    generatedAt:scored.generatedAt
  };

  console.log('[KPI ETL ALL-SHEET] ' + JSON.stringify(result));
  return result;
}

function materializeForecastFact_() {
  const t0 = Date.now();
  setFactState_('FORECAST','', 'RUNNING',0,new Date().toISOString(),'',{});
  removeChunkedCacheJson_(CACHE_CFG.FORECAST_MODEL_KEY);
  const source = buildForecastModel_(); // ONLY ETL calls Historical Forecast scanner.
  if (!source || source.sheetFound === false) {
    writeFactSheet_(FACT_ENGINE_CFG.FORECAST_SHEET, FORECAST_FACT_HEADERS, []);
    const meta = { generatedAt:new Date().toISOString(), rows:0, sourceRows:0, parsedRows:0, matchedRows:0, unmatchedRows:0, matchedHubCount:0, unmatchedSample:[], sheetName:FORECAST_CFG.SHEET_NAME, error:'FORECAST_SOURCE_NOT_FOUND' };
    PropertiesService.getScriptProperties().setProperty(FACT_ENGINE_CFG.FORECAST_META_PROP, JSON.stringify(meta));
    setFactState_('FORECAST','', 'ERROR',0,meta.generatedAt,'',meta);
    throw new Error('FORECAST_SOURCE_NOT_FOUND: Sheet "' + FORECAST_CFG.SHEET_NAME + '" not found.');
  }
  const meta = persistForecastFact_(source);
  return {
    ok:true,
    rows:meta.rows,
    sourceRows:meta.sourceRows,
    parsedRows:meta.parsedRows,
    matchedRows:meta.matchedRows,
    unmatchedRows:meta.unmatchedRows,
    matchedHubCount:meta.matchedHubCount,
    ms:Date.now()-t0,
    generatedAt:meta.generatedAt
  };
}


function withEtlLock_(name, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok:false, skipped:true, reason:'ETL_BUSY', pipeline:name };
  try { return fn(); } finally { lock.releaseLock(); }
}

function runCurrentKpiFactETL() {
  return withEtlLock_('KPI_DAILY_DIRECT', function(){
    const started = Date.now();
    const model = getKpiDailyDirectModel_(true);
    return {
      ok:true,
      directSource:true,
      sheetName:model.sheetName || 'KPI Daily',
      rows:(model.rows || []).length,
      periods:model.periods || [],
      generatedAt:model.generatedAt || '',
      ms:Date.now() - started
    };
  });
}


function runForecastFactETL() {
  return withEtlLock_('FORECAST', function(){
    const started = Date.now();
    console.log('[FORECAST ETL] START');
    try {
      const result = materializeForecastFact_();
      setRuntimeStatus_({
        materializedForecastAt:new Date().toISOString(),
        materializedForecastMs:result.ms,
        materializedForecastRows:result.rows,
        lastForecastEtlStatus:'READY'
      });
      console.log('[FORECAST ETL] READY • ' + result.rows + ' matched rows • ' + result.unmatchedRows + ' unmatched • ' + (Date.now()-started) + ' ms');
      return result;
    } catch (err) {
      const message = String(err && err.message || err);
      const meta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(FACT_ENGINE_CFG.FORECAST_META_PROP), {});
      setFactState_('FORECAST','', 'ERROR',Number(meta.rows||0),new Date().toISOString(),'',{ error:message, meta:meta });
      setRuntimeStatus_({ lastForecastEtlAt:new Date().toISOString(), lastForecastEtlStatus:'ERROR', lastForecastEtlError:message });
      console.error('[FORECAST ETL] ERROR • ' + message);
      throw err;
    }
  });
}


/**
 * Scheduled production refresh.
 * Runs 3 times/day at 07:00, 12:00 and 18:00 Asia/Ho_Chi_Minh.
 * One lock covers the entire KPI + Forecast refresh so two pipelines cannot
 * publish over one another.
 */
function runScheduledPerformanceRefresh() {
  return withEtlLock_('FULL_PERFORMANCE_REFRESH', function(){
    const started = Date.now();
    const result = {
      ok:false,
      startedAt:new Date().toISOString(),
      security:null,
      kpiResult:null,
      dailyKpi:null,
      forecast:null
    };

    try {
      // Warm authorization first. User login after 07/12/18 should not scan
      // Permission or Adhoc user sheets.
      const permission = getPermissionModel_(false);
      const admins = getAdhocAdminIndex_(false);
      result.security = {
        stations:(permission.stations || []).length,
        users:Object.keys(permission.users || {}).length,
        admins:Object.keys(admins || {}).length,
        securityVersion:getSecurityVersion_()
      };

      // Final-result datasets: one source refresh at 07:00 / 12:00 / 18:00.
      const kpiModel = getKpiModel_(true);
      const dailyModel = getKpiDailyDirectModel_(true);
      result.kpiResult = {
        rows:(kpiModel.rows || []).length,
        months:kpiModel.months || []
      };
      result.dailyKpi = {
        rows:(dailyModel.rows || []).length,
        periods:dailyModel.periods || []
      };

      // Historical Forecast source is materialized once in the same window.
      try {
        result.forecast = materializeForecastFact_();
      } catch (forecastErr) {
        result.forecast = {
          ok:false,
          rows:0,
          error:String(forecastErr && forecastErr.message || forecastErr)
        };
      }

      const forecastRows = Number(result.forecast && result.forecast.rows || 0);
      const version = publishDataRefreshVersion_(
        result.kpiResult.rows,
        result.dailyKpi.rows,
        forecastRows
      );

      result.version = version.version;
      result.refreshedAt = version.refreshedAt;
      result.ok = true;
      result.ms = Date.now() - started;

      setRuntimeStatus_({
        lastFullRefreshAt:result.refreshedAt,
        lastFullRefreshStatus:'READY',
        lastFullRefreshMs:result.ms,
        lastFullRefreshKpiRows:result.kpiResult.rows,
        lastFullRefreshDailyRows:result.dailyKpi.rows,
        lastFullRefreshForecastRows:forecastRows,
        kpiRuntimeArchitecture:'FINAL_RESULT_MASTER_CACHE'
      });

      return result;
    } catch (err) {
      const message = String(err && err.message || err);
      setRuntimeStatus_({
        lastFullRefreshAt:new Date().toISOString(),
        lastFullRefreshStatus:'ERROR',
        lastFullRefreshError:message,
        lastFullRefreshMs:Date.now() - started
      });
      throw err;
    }
  });
}

function warmRuntimeCachesAfterMerge_() {
  const started = Date.now();
  const period = dailyKpiCurrentPeriod_();
  const status = {
    ok:true,
    period:period,
    warmedAt:new Date().toISOString(),
    steps:{}
  };

  function step(name, fn) {
    const t0 = Date.now();
    try {
      const value = fn();
      status.steps[name] = {
        ok:true,
        ms:Date.now() - t0,
        value:value == null ? null : value
      };
      return value;
    } catch (err) {
      status.ok = false;
      status.steps[name] = {
        ok:false,
        ms:Date.now() - t0,
        error:String(err && err.message || err)
      };
      return null;
    }
  }

  // Shared security/config caches.
  const permission = step('permission', function(){
    const x = getPermissionModel_(true);
    return { stations:(x.stations || []).length };
  });

  step('adminIndex', function(){
    const x = getAdhocAdminIndex_(true);
    return { admins:Object.keys(x || {}).length };
  });

  step('targetProd', function(){
    const x = getTargetProdModel_(true);
    return {
      rows:(x.rows || []).length,
      periods:(x.periods || []).length
    };
  });

  step('kpiConfig', function(){
    const x = getKpiConfigModel_(true);
    return {
      version:Number(x.version || 0),
      source:x.source || ''
    };
  });

  // Warm the ENTIRE current Daily KPI period into the chunked ScriptCache.
  // This is the most important performance step: SUP/AOM/HUB requests can
  // filter cached rows instead of calling SpreadsheetApp.getRange().
  step('dailyKpiFullPeriod', function(){
    const hubs = typeof getMergedDailyHubCatalog_ === 'function'
      ? getMergedDailyHubCatalog_(true)
      : ((permission && permission.stations) || []);

    const hubCodes = (hubs || [])
      .map(function(h){ return h.hubCode; })
      .filter(Boolean);

    const fact = readMergedDailyKpiSlice_(period, hubCodes, true);

    return {
      hubs:hubCodes.length,
      rows:fact ? (fact.rows || []).length : 0,
      buildId:fact ? fact.buildId || '' : ''
    };
  });

  // Forecast fact is read from its materialized sheet and cached.
  step('forecast', function(){
    removeChunkedCacheJson_(FACT_ENGINE_CFG.FORECAST_CACHE_KEY);
    const x = readForecastFact_();
    return { rows:x ? (x.rows || []).length : 0 };
  });

  // Monthly KPI Result used by Dashboard Overview.
  step('monthlyKpi', function(){
    removeChunkedCacheJson_(CACHE_CFG.KPI_MODEL_KEY);
    const x = getKpiModel_(true);
    return { rows:(x.rows || []).length };
  });

  step('workspaceBootstrap', function(){
    if (typeof warmCurrentUserWorkspaceBootstrap_ !== 'function') {
      return { ok:false, reason:'MODULE_NOT_FOUND' };
    }
    return warmCurrentUserWorkspaceBootstrap_();
  });

  status.ms = Date.now() - started;

  setRuntimeStatus_({
    cacheWarmStatus:status.ok ? 'READY' : 'WARNING',
    cacheWarmedAt:status.warmedAt,
    cacheWarmMs:status.ms,
    cacheWarmPeriod:period
  });

  console.log('[CACHE WARM] ' + JSON.stringify(status));
  return status;
}

function warmFastRuntimeCaches() {
  // Manual compatibility entry point.
  return warmRuntimeCachesAfterMerge_();
}

function warmHeavyRuntimeCaches() {
  // Kept for backward compatibility. The master warm function already warms
  // both Daily KPI and Monthly KPI/Forecast caches.
  return warmRuntimeCachesAfterMerge_();
}

function installPerformanceTriggers() {
  requireAdmin_();

  const legacyHandlers = [
    FACT_ENGINE_CFG.FULL_REFRESH_HANDLER,
    FACT_ENGINE_CFG.KPI_ETL_HANDLER,
    FACT_ENGINE_CFG.FORECAST_ETL_HANDLER,
    RUNTIME_CFG.FAST_WARM_HANDLER,
    RUNTIME_CFG.HEAVY_WARM_HANDLER
  ];

  ScriptApp.getProjectTriggers().forEach(function(trigger){
    if (legacyHandlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  FACT_ENGINE_CFG.FULL_REFRESH_HOURS.forEach(function(hour){
    ScriptApp.newTrigger(FACT_ENGINE_CFG.FULL_REFRESH_HANDLER)
      .timeBased()
      .atHour(hour)
      .nearMinute(0)
      .everyDays(1)
      .inTimezone(FACT_ENGINE_CFG.FULL_REFRESH_TIMEZONE)
      .create();
  });

  // Build current master caches immediately after install.
  const initial = runScheduledPerformanceRefresh();
  const status = getMaterializedTriggerStatus_();

  return {
    ok:status.every(function(x){ return x.installed && x.count === x.expectedCount; }),
    timezone:FACT_ENGINE_CFG.FULL_REFRESH_TIMEZONE,
    schedule:FACT_ENGINE_CFG.FULL_REFRESH_HOURS.map(function(h){ return String(h).padStart(2,'0') + ':00'; }),
    triggers:status,
    initialRefresh:initial,
    installedAt:new Date().toISOString()
  };
}


function initializePerformanceBackend() {
  const init = beginEngineInitialization_();
  const result = {
    ok:false,
    runId:init.runId,
    startedAt:init.startedAt,
    version:APP.VERSION,
    architecture:'Permission + KPI Result cache + KPI Daily direct cache + Forecast fact'
  };

  runEngineInitStep_(result,'setup','SETUP',function(){ return setupApp(); });
  runEngineInitStep_(result,'permission','PERMISSION',function(){
    const m=getPermissionModel_(true);
    return { ok:true, stations:(m.stations || []).length, users:Object.keys(m.users || {}).length };
  });
  // Installing triggers also performs ONE immediate full refresh.
  runEngineInitStep_(result,'triggers','INSTALL_AND_INITIAL_REFRESH',function(){ return installPerformanceTriggers(); });

  result.ok = !Object.keys(result).some(function(k){
    return result[k] && typeof result[k] === 'object' && result[k].ok === false;
  });
  result.completedAt = new Date().toISOString();
  updateEngineInitState_('COMPLETE', result.ok ? 'READY' : 'PARTIAL', result);
  return result;
}


function forceRefreshMaterializedFacts() {
  const admin = requireAdmin_();
  const result = runScheduledPerformanceRefresh();
  return {
    ok:true,
    refreshedBy:admin.email,
    result:result,
    serverTime:new Date().toISOString()
  };
}

function materializeKpiPeriod(period) {
  requireAdmin_();
  return withEtlLock_('KPI_PERIOD', function(){ return materializeDailyKpiPeriod_(dailyKpiNormalizePeriod_(period)); });
}

/**
 * ADMIN manual command for V0.16.
 * Reads ALL rows / ALL columns from:
 * FM_On_time, LM_Ontime, DSR, SOP, PROD_RIDER, PROD_SORTER
 * then rebuilds the current-month materialized KPI facts.
 */
function refreshCurrentMonthAllKpiSheets() {
  // V0.16.9 compatibility alias: full Daily KPI sources are merged into one
  // sheet, so manual refresh rebuilds the unified fact.
  const admin = requireAdmin_();
  const result = runMergedDailyKpiETL();
  result.refreshedBy = admin.email;
  return result;
}


function backfillAllDailyKpiFacts() {
  requireAdmin_();
  const meta=buildDailyKpiMeta_();
  const periods=(meta.periods||[]).slice().sort();
  const results=[];
  // One manual call may hit Apps Script execution time if history is large.
  // Keep a safety cap; call again after completed periods are materialized.
  const materialized={};
  getDb_().getSheets().forEach(function(sh){
    if (sh.getName().indexOf(FACT_ENGINE_CFG.SCORE_PREFIX)===0) materialized[sh.getName()]=true;
  });
  for (let i=0;i<periods.length && results.length<3;i++) {
    const p=periods[i];
    if (materialized[dailyScoreFactSheetName_(p)]) continue;
    results.push(materializeDailyKpiPeriod_(p));
  }
  return { ok:true,totalSourcePeriods:periods.length,builtThisRun:results.length,results:results,note:'Runs max 3 missing periods per call to stay within Apps Script execution limits.' };
}

function getBackendHealth() {
  const access = requireAdmin_();
  return buildBackendHealth_(access.email);
}



function buildBackendHealth_(checkedBy) {
  const current = dailyKpiCurrentPeriod_();
  const mergedMeta = ensureMergedDailyKpiMeta_(false) || {};
  const forecastMeta = factJsonParse_(PropertiesService.getScriptProperties().getProperty(FACT_ENGINE_CFG.FORECAST_META_PROP),{});
  const states = getFactStates_();
  const stateMap = {};
  states.forEach(function(s){ stateMap[s.pipeline + '|' + s.period] = s; });

  const dailyPhysical = inspectPhysicalFactSheet_(MERGED_DAILY_KPI_CFG.SHEET_NAME, mergedDailyKpiHeaders_().length);
  const forecastPhysical = inspectPhysicalFactSheet_(FACT_ENGINE_CFG.FORECAST_SHEET, FORECAST_FACT_HEADERS.length);

  const mergedState = stateMap[MERGED_DAILY_KPI_CFG.STATE_PIPELINE + '|'] || {};
  const mergedStatus = mergedState.status || (mergedMeta.generatedAt ? 'READY' : 'NOT_READY');
  const daily = {
    status:mergedStatus,
    ready:mergedStatus === 'READY' || mergedStatus === 'READY_WITH_WARNINGS',
    sheet:MERGED_DAILY_KPI_CFG.SHEET_NAME,
    sheetExists:dailyPhysical.exists,
    physicalRows:dailyPhysical.rows,
    rows:Number(mergedMeta.rows || dailyPhysical.rows || 0),
    rawRows:Number(mergedMeta.rawRows || 0),
    generatedAt:mergedMeta.generatedAt || '',
    buildId:mergedMeta.buildId || '',
    periods:mergedMeta.periods || [],
    readMode:'MATERIALIZED_ONLY',
    sourceMeta:mergedMeta.sourceMeta || {},
    validation:mergedMeta.validation || {},
    dirty:!!getRuntimeStatus_().mergedDailyKpiDirty
  };

  // Backward-compatible alias. Daily KPI runtime source is the single merged sheet.
  const raw = {
    status:daily.status,
    ready:daily.ready,
    sheet:MERGED_DAILY_KPI_CFG.SHEET_NAME,
    sheetExists:dailyPhysical.exists,
    physicalRows:dailyPhysical.rows,
    rows:daily.rows,
    generatedAt:daily.generatedAt,
    readMode:'KPI_DAILY_MERGE_SHEET_ONLY',
    sourceMeta:mergedMeta.sourceMeta || {},
    etlSourceMeta:mergedMeta.etlSourceMeta || {},
    validation:mergedMeta.validation || {}
  };

  const forecastState = stateMap['FORECAST|'] || {};
  const forecastStatus = forecastState.status || (forecastMeta.generatedAt ? 'READY' : 'NOT_READY');
  const forecast = {
    status:forecastStatus,
    ready:forecastStatus === 'READY' || forecastStatus === 'READY_WITH_WARNINGS',
    sheet:forecastPhysical.name,
    sheetExists:forecastPhysical.exists,
    physicalRows:forecastPhysical.rows,
    rows:Number(forecastMeta.rows || forecastPhysical.rows || 0),
    generatedAt:forecastMeta.generatedAt || '',
    sourceRows:Number(forecastMeta.sourceRows || 0),
    parsedRows:Number(forecastMeta.parsedRows || 0),
    matchedRows:Number(forecastMeta.matchedRows || forecastMeta.rows || 0),
    unmatchedRows:Number(forecastMeta.unmatchedRows || 0),
    matchedHubCount:Number(forecastMeta.matchedHubCount || 0),
    unmatchedSample:forecastMeta.unmatchedSample || [],
    sourceSheet:forecastMeta.sheetName || FORECAST_CFG.SHEET_NAME
  };

  return {
    ok:true,
    checkedBy:String(checkedBy || ''),
    version:APP.VERSION,
    architecture:'KPI Daily Merge sheet -> read-only Daily KPI API (raw merge only in scheduled ETL)',
    currentPeriod:current,
    initialization:getEngineInitState_(),
    facts:{ kpiRaw:raw, kpiDaily:daily, forecast:forecast },
    triggers:getMaterializedTriggerStatus_(),
    states:states,
    runtime:getRuntimeStatus_(),
    serverTime:new Date().toISOString()
  };
}

function getMaterializedInitStatus() {
  const access = requireAdmin_();
  return buildBackendHealth_(access.email);
}

function debugMaterializedBackend() {
  const access = requireAdmin_();
  const result = buildBackendHealth_(access.email);
  console.log('===== SPX MATERIALIZED BACKEND HEALTH =====');
  console.log(JSON.stringify(result,null,2));
  return result;
}

function debugForecastMaterialization() {
  const access = requireAdmin_();
  const t0 = Date.now();
  removeChunkedCacheJson_(CACHE_CFG.FORECAST_MODEL_KEY);
  const ss = getDb_();
  const source = findForecastSheet_(ss);
  if (!source) {
    const missing = { ok:false, checkedBy:access.email, error:'FORECAST_SOURCE_NOT_FOUND', expected:FORECAST_CFG.SHEET_ALIASES || [FORECAST_CFG.SHEET_NAME] };
    console.log(JSON.stringify(missing,null,2));
    return missing;
  }
  const model = buildForecastModel_();
  const matched = (model.rows || []).filter(function(r){ return !!r.hubCode; });
  const unmatched = (model.rows || []).filter(function(r){ return !r.hubCode; });
  const matchedHubs = {};
  matched.forEach(function(r){ matchedHubs[normalizeCompare_(r.hubCode)] = true; });
  const result = {
    ok:true,
    checkedBy:access.email,
    sourceSheet:source.getName(),
    sourceRows:Number(model.sourceRows || Math.max(0,source.getLastRow()-1)),
    headerRow:model.headerRow || 0,
    headers:model.headers || [],
    fieldMap:model.fieldMap || {},
    parsedRows:(model.rows || []).length,
    matchedRows:matched.length,
    unmatchedRows:unmatched.length,
    matchedHubCount:Object.keys(matchedHubs).length,
    permissionStationCount:(getPermissionModel_(false).stations || []).length,
    unmatchedSample:unmatched.slice(0,50).map(function(r){ return r.sourceHubName || ''; }),
    ms:Date.now()-t0
  };
  console.log('===== HISTORICAL FORECAST MAPPING DIAGNOSTIC =====');
  console.log(JSON.stringify(result,null,2));
  return result;
}

/* ---------------- GOVERNANCE WRITE HOOKS ---------------- */

// Wrap the existing governance functions once, preserving business logic while
// immediately refreshing the scored ScriptCache from RAW fact (no raw scan).
const __V130_saveInitialProdTargets = saveInitialProdTargets;
saveInitialProdTargets = function(payload) {
  const result = __V130_saveInitialProdTargets(payload);
  const period = dailyKpiNormalizePeriod_(payload && payload.period) || dailyKpiCurrentPeriod_();
  markMergedDailyKpiDirty_(period, 'TARGET_INITIAL');
  return result;
};

const __V130_reviewTargetProdRequest = reviewTargetProdRequest;
reviewTargetProdRequest = function(requestId, decision, note) {
  const result = __V130_reviewTargetProdRequest(requestId, decision, note);
  if (result && result.status === 'APPROVED') {
    // Find request period from request sheet only after the governance write.
    try {
      const sh=getRequiredSheet_(DAILY_KPI_CFG.REQUEST_SHEET);
      const vals=sh.getRange(2,1,Math.max(0,sh.getLastRow()-1),4).getDisplayValues();
      const hit=vals.find(function(r){return String(r[0]||'')===String(requestId||'');});
      const period=hit ? dailyKpiNormalizePeriod_(hit[1]) : dailyKpiCurrentPeriod_();
      markMergedDailyKpiDirty_(period,'TARGET_APPROVED');
    } catch (_) {}
  }
  return result;
};

const __V130_saveKpiConfiguration = saveKpiConfiguration;
saveKpiConfiguration = function(payload) {
  const result = __V130_saveKpiConfiguration(payload);
  const period = dailyKpiNormalizePeriod_(payload && payload.period) || dailyKpiCurrentPeriod_();
  markMergedDailyKpiDirty_(period,'KPI_CONFIG_CHANGED');
  return result;
};



/** V0.16.7 one-time migration / diagnostic after Permission schema change. */
function refreshPermissionSchemaV167() {
  const admin = requireAdmin_();
  getAdhocAdminIndex_(true);
  clearPermissionCache_(true);
  bumpSecurityVersion_();
  const model = getPermissionModel_(true);
  const counts = { SAOM:0, AOM:0, SUP:0, HUB:0 };
  Object.keys(model.users || {}).forEach(function(email) {
    const r = normalizeRank_(model.users[email].rank);
    if (counts[r] !== undefined) counts[r] += 1;
  });
  const result = {
    ok:true,
    refreshedBy:admin.email,
    schema:model.schema || '',
    sheetName:model.sheetName || '',
    headerRow:model.headerRow || 0,
    physicalRows:model.physicalPermissionRows || 0,
    stations:model.stationCount || 0,
    leadHeaders:model.leadHeaders || [],
    rankCounts:counts,
    generatedAt:model.generatedAt || ''
  };
  console.log('[PERMISSION V167] ' + JSON.stringify(result));
  return result;
}


/** V0.16.8 diagnostic: Target Prod KPI priority + previous-month suggestion. */
function debugTargetProdPriorityV168(period, hubCode) {
  const access = requireAccess_(['dashboard', 'kpi']);
  period = dailyKpiNormalizePeriod_(period) || dailyKpiCurrentPeriod_();
  const permission = getPermissionModel_(false);
  const station = hubCode ? dailyKpiAssertHubAccess_(access, hubCode) : null;
  const model = buildTargetProdModel_(true);
  const result = {
    ok:true,
    period:period,
    officialSheetFound:model.officialSheetFound,
    officialSheetName:model.officialSheetName,
    officialError:model.officialError,
    manualSheetFound:model.manualSheetFound,
    officialRows:(model.rows || []).filter(function(r){return r.source === 'TARGET_PROD_KPI';}).length,
    manualRows:(model.rows || []).filter(function(r){return r.source === 'TARGET_PROD_MANUAL';}).length
  };
  if (station) {
    result.hub = { hubCode:station.hubCode, hubName:station.hubName };
    result.current = dailyKpiTargetByHub_(model, period, station);
    result.suggestion = dailyKpiTargetSuggestion_(model, period, station);
  }
  console.log(JSON.stringify(result,null,2));
  return result;
}


// Backlog EOD History API (bundled with the dashboard backend).
// Read-only history API; never starts a capture job from the dashboard.
function getBacklogEodHistory(){
  const access=requireAccess_(['dashboard']);if(access.rank==='NORMAL')throw Error('ACCESS_DENIED');
  const permission=getPermissionModel_(false),allowed=new Set(fullAuthorizedHubCodes_(access,permission).map(normalizeCompare_));
  const catalog=permission.stations.filter(s=>allowed.has(normalizeCompare_(s.hubCode))).map(s=>({code:s.hubCode,name:s.hubName}));
  const id=PropertiesService.getScriptProperties().getProperty('D0_DB_SHEET_ID');
  if(!id)throw Error('Backend database is not configured. Set backendId in Deployment.gs and run setupAppsScript.');
  const sheet=SpreadsheetApp.openById(id).getSheetByName('Backlog EOD History');
  if(!sheet)return backlogHistoryView_([],catalog,false);
  const values=sheet.getDataRange().getValues(),headers=(values.shift()||[]).map(v=>String(v).replace(/^\uFEFF/,'').trim());
  ['station_name','total_backlog_d0','snapshot_date'].forEach(name=>{if(headers.indexOf(name)<0)throw Error('Backlog EOD History: missing column '+name)});
  const rows=values.map(row=>{const r={};headers.forEach((h,i)=>r[h]=row[i] instanceof Date?Utilities.formatDate(row[i],'Asia/Ho_Chi_Minh','yyyy-MM-dd\'T\'HH:mm:ssXXX'):row[i]);return r});
  return backlogHistoryView_(rows,catalog,true);
}
function backlogHistoryView_(rows,catalog,available){
  const canonical=v=>String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ');
  const byCode={},byName={},unique={};catalog.forEach(h=>{byCode[canonical(h.code)]=h;byName[canonical(h.name)]=h});
  rows.forEach(r=>{
    const h=byCode[canonical(r.hub_code)]||byName[canonical(r.station_name)];
    const day=String(r.snapshot_date||'').slice(0,10),raw=r.total_backlog_d0;
    if(!h||!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
    const number=raw==null||String(raw).trim()===''?null:Number(raw);
    const item={hubCode:h.code,stationName:h.name,date:day,reportDate:String(r.report_date||'').slice(0,10),backlog:number!==null&&isFinite(number)&&number>=0?number:null,fetchedAt:String(r.fetched_at||''),capturedAt:String(r.captured_at||'')};
    const key=day+'|'+h.code,previous=unique[key];
    if(!previous||item.capturedAt>=previous.capturedAt)unique[key]=item;
  });
  return {available:available,source:'Backlog EOD History',rows:Object.keys(unique).map(k=>unique[k]).sort((a,b)=>a.date.localeCompare(b.date)||a.stationName.localeCompare(b.stationName))};
}


// Custom non-admin access grants (bundled with the dashboard backend).
/** Explicit non-admin HUB/page grants. Bundled into exported code.gs. */
const ACCESS_GRANT_CFG=Object.freeze({sheet:'Access Grants',headers:['EMAIL','DISPLAY_NAME','PROFILE','ACTIVE','HUB_CODES','PAGES','NOTE','UPDATED_AT','UPDATED_BY','REVISION'],profiles:['HUB_VIEWER','OPERATIONS_VIEWER','CUSTOM'],pages:['dashboard','kpi','d0','alerts','backlog','compensated']});
function accessGrantRows_(){
 const sheet=getDb_().getSheetByName(ACCESS_GRANT_CFG.sheet);if(!sheet||sheet.getLastRow()===0)return [];
 const values=sheet.getDataRange().getValues(),header=values.shift();if(ACCESS_GRANT_CFG.headers.some((h,i)=>header[i]!==h))throw Error('ACCESS_GRANTS_SCHEMA_INVALID');
 const seen={};return values.flatMap((r,i)=>{const email=normalizeEmail_(r[0]);if(!email)return [];if(seen[email])throw Error('ACCESS_GRANTS_DUPLICATE_EMAIL');seen[email]=true;
  function list(v){try{const out=JSON.parse(String(v||'[]'));if(!Array.isArray(out))throw Error();return out}catch(_){throw Error('ACCESS_GRANTS_INVALID_LIST:'+email)}}
  return [{email:email,displayName:String(r[1]||''),profile:String(r[2]||''),active:toBool_(r[3]),hubCodes:list(r[4]),pages:list(r[5]),note:String(r[6]||''),updatedAt:r[7] instanceof Date?r[7].toISOString():String(r[7]||''),updatedBy:String(r[8]||''),revision:String(r[9]||''),row:i+2}];
 });
}
function accessGrantIndex_(){
 const key='spx:custom-access:v1:'+getSecurityVersion_();const cached=getChunkedCacheJson_(key);if(cached)return cached;
 const index={};accessGrantRows_().forEach(r=>index[r.email]=r);putChunkedCacheJson_(key,index,300);return index;
}
function getCustomAccessGrant_(email){const grant=accessGrantIndex_()[normalizeEmail_(email)];return grant&&grant.profile!=='DELETED'?grant:null}
function customGrantAccess_(grant){
 const model=getPermissionModel_(false),set=new Set(grant.hubCodes.map(String)),stations=(model.stations||[]).filter(s=>set.has(String(s.hubCode))),valid=ACCESS_GRANT_CFG.profiles.includes(grant.profile)&&grant.pages.length>0&&grant.pages.every(p=>ACCESS_GRANT_CFG.pages.includes(p));
 return {allowed:!!grant.active&&valid&&stations.length>0,email:grant.email,displayName:grant.displayName||displayNameFromEmail_(grant.email),role:grant.profile,rank:'HUB',assignedType:'HUB',assignedValue:stations.map(s=>s.hubCode).join(';'),hubCodes:stations.map(s=>s.hubCode),hubNames:stations.map(s=>s.hubName),stations:stations.map(permissionStationSummary_),isAdmin:false,isSuperAdmin:false,source:'CUSTOM_HUB_ACCESS',managedAccount:true,customAccess:true,allowedPages:grant.pages.slice(),permissionProfile:grant.profile};
}
function assertPageAccess_(access,pages){
 if(!access.customAccess||access.isAdmin||!pages)return;
 const wanted=Array.isArray(pages)?pages:[pages];if(!wanted.some(p=>(access.allowedPages||[]).includes(p)))throw Error('PAGE_ACCESS_DENIED:'+wanted.join('|'));
}
function accessGrantProtected_(email){if(isSuperAdminEmail_(email))return true;const account=getAdhocAdminIndex_(false)[email];return !!(account&&String(account.source||'').toUpperCase()!=='ADHOC_DELETED'&&String(account.role).toUpperCase()==='ADMIN')}
function getAccessGrantSettings(){
 requireAdmin_();const model=getPermissionModel_(false),managed=getAdhocAdminIndex_(false),grants=accessGrantRows_().filter(g=>g.profile!=='DELETED'),byGrant={};grants.forEach(g=>byGrant[g.email]=g);
 const emails=Array.from(new Set(Object.keys(model.users||{}).concat(Object.keys(managed),grants.map(g=>g.email))));
 const accounts=emails.map(email=>{const base=(model.users||{})[email],account=managed[email],managedLive=account&&String(account.source||'').toUpperCase()!=='ADHOC_DELETED',protectedAdmin=isSuperAdminEmail_(email)||!!(managedLive&&String(account.role).toUpperCase()==='ADMIN'),g=byGrant[email];if(!base&&!managedLive&&!g)return null;
  const blocked=managedLive&&!account.active;let role=protectedAdmin?'ADMIN':g?g.profile:managedLive?'NORMAL':base.rank,codes=protectedAdmin?(model.stations||[]).map(s=>s.hubCode):g?g.hubCodes:managedLive?[]:base.hubCodes;
  return {email:email,displayName:g?g.displayName:account&&account.displayName||base&&base.displayName||'',role:role,hubCodes:codes,hubCount:codes.length,active:!blocked&&(!g||g.active),source:g?'Custom access':managedLive?'Managed account':'Permission mapping',protectedAdmin:protectedAdmin,custom:!!g,pages:g?g.pages:[],revision:g?g.revision:'',fallbackRole:managedLive?String(account.role):base?base.rank:'NONE',fallbackHubCount:managedLive?0:base?(base.hubCodes||[]).length:0,fallbackActive:managedLive?!!account.active:!!base};
 }).filter(Boolean).sort((a,b)=>a.email.localeCompare(b.email));
 return {ok:true,accounts:accounts,grants:grants.map(g=>{const r=Object.assign({},g);delete r.row;return r}),hubs:(model.stations||[]).map(s=>({code:s.hubCode,name:s.hubName,zone:s.zone||''})),profiles:ACCESS_GRANT_CFG.profiles.slice(),pages:ACCESS_GRANT_CFG.pages.slice()};
}
function accessGrantClean_(payload){
 payload=payload||{};const email=normalizeEmail_(payload.email);if(!isValidEmail_(email))throw Error('Enter a valid email address.');if(accessGrantProtected_(email))throw Error('ADMIN_PROTECTED: Manage Admin accounts in Set Account.');
 if(!ACCESS_GRANT_CFG.profiles.includes(payload.profile))throw Error('INVALID_ACCESS_PROFILE');
 if(payload.active!==undefined&&typeof payload.active!=='boolean')throw Error('INVALID_ACTIVE_FLAG');
 if(!Array.isArray(payload.hubCodes)||!payload.hubCodes.length||payload.hubCodes.length>500)throw Error('Select at least one HUB.');
 const catalog=new Map((getPermissionModel_(false).stations||[]).map(s=>[String(s.hubCode),s]));const hubCodes=Array.from(new Set(payload.hubCodes.map(String)));if(hubCodes.some(c=>!catalog.has(c)))throw Error('UNKNOWN_HUB_CODE');
 if(!Array.isArray(payload.pages)||!payload.pages.length||payload.pages.some(p=>!ACCESS_GRANT_CFG.pages.includes(p)))throw Error('Select valid viewing permissions.');
 return {email:email,displayName:cleanText_(payload.displayName||displayNameFromEmail_(email),120),profile:payload.profile,active:payload.active!==false,hubCodes:hubCodes.sort(),pages:Array.from(new Set(payload.pages)).sort(),note:cleanText_(payload.note||'',500),revision:String(payload.revision||'')};
}
function accessGrantWrite_(grant,admin,expected){
 let sheet=getDb_().getSheetByName(ACCESS_GRANT_CFG.sheet);const current=accessGrantRows_().find(g=>g.email===grant.email);
 if((!current&&expected)||(current&&(current.profile==='DELETED'?!!expected:current.revision!==expected)))throw Error('ACCESS_CHANGED: Reload this account before saving.');
 if(!sheet)sheet=getDb_().insertSheet(ACCESS_GRANT_CFG.sheet);if(!sheet.getLastRow())sheet.getRange(1,1,1,ACCESS_GRANT_CFG.headers.length).setValues([ACCESS_GRANT_CFG.headers.slice()]);
 const now=new Date().toISOString(),revision=Utilities.getUuid(),safe=s=>/^[=+@\-]/.test(String(s))?"'"+s:s;
 sheet.getRange(current?current.row:sheet.getLastRow()+1,1,1,ACCESS_GRANT_CFG.headers.length).setValues([[grant.email,safe(grant.displayName),grant.profile,grant.active,JSON.stringify(grant.hubCodes),JSON.stringify(grant.pages),safe(grant.note),now,admin.email,revision]]);
 SpreadsheetApp.flush();clearSecurityCaches_();return {ok:true,email:grant.email,revision:revision,updatedAt:now};
}
function saveAccessGrant(payload){requireAdmin_();return withShortWriteLock_(function(){const admin=requireAdmin_(),clean=accessGrantClean_(payload);return accessGrantWrite_(clean,admin,clean.revision)})}
function removeAccessGrant(email,revision){requireAdmin_();return withShortWriteLock_(function(){const admin=requireAdmin_();email=normalizeEmail_(email);if(accessGrantProtected_(email))throw Error('ADMIN_PROTECTED');const current=accessGrantRows_().find(g=>g.email===email&&g.profile!=='DELETED');if(!current)throw Error('CUSTOM_ACCESS_NOT_FOUND');return accessGrantWrite_({email:email,displayName:current.displayName,profile:'DELETED',active:false,hubCodes:[],pages:[],note:'Custom access removed; automatic access rules apply.'},admin,String(revision||''))})}

/**
 * Public Web API entry points.
 * Ensures critical client RPC endpoints are always present in Code.gs
 * regardless of whether WorkspaceApi.gs is copied separately to Google Apps Script.
 */
function getKpiClientMonthCache(month, force) {
  return getKpiClientMonthCacheUncached_(month, force);
}
function getDailyKpiClientPeriodCache(period, force) {
  return getDailyKpiClientPeriodCacheUncached_(period, force);
}
function getForecastClientMasterCache(force) {
  return getForecastClientMasterCacheUncached_(force);
}
function deployHubCatalog_(access, permission) {
  const allowed = new Set(fullAuthorizedHubCodes_(access, permission).map(normalizeCompare_));
  return (permission.stations || []).filter(function(s){return allowed.has(normalizeCompare_(s.hubCode))})
    .map(function(s){return {code:s.hubCode,name:s.hubName,zone:s.zone||'',aom:s.aom||[],sup:s.sup||[]}});
}
function deployReadRows_(db, name) {
  const sheet = db.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(function(v){return String(v || '').trim()});
  return values.filter(function(row){return row.some(function(v){return v !== '' && v != null})}).map(function(row){
    const result = {};
    headers.forEach(function(key, i){
      if (!key) return;
      const value = row[i];
      result[key] = value instanceof Date
        ? Utilities.formatDate(value,'Asia/Ho_Chi_Minh',key==='hour'?'HH:mm':/fetched|captured|computed|^datetime$/i.test(key)?"yyyy-MM-dd'T'HH:mm:ssXXX":'yyyy-MM-dd')
        : value == null ? null : value;
    });
    return result;
  });
}
function workspaceD0Rows_(access, section) {
  const names = section ? d0SectionSheets_(section) : d0SectionSheets_();
  if (!section || section === 'attendance') names.push('BigQuery Attendance');
  return workspaceD0NamedRows_(access,names);
}
function workspaceD0NamedRows_(access, names) {
  const id = PropertiesService.getScriptProperties().getProperty('D0_DB_SHEET_ID');
  if (!id) throw Error('D0_DB_SHEET_ID is not configured.');
  const catalog = deployHubCatalog_(access,getPermissionModel_(false));
  const key = function(v){return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ')};
  const aliases = {};
  catalog.forEach(function(h){aliases[key(h.code)]=h;aliases[key(h.name)]=h});
  const db = SpreadsheetApp.openById(id), sheets = {};
  names.forEach(function(name){
    sheets[name]=deployReadRows_(db,name).flatMap(function(row){
      const hub=aliases[key(row.hub_code)]||aliases[key(row.station_name)];
      return hub ? [Object.assign({},row,{hub_code:hub.code,zone:hub.zone,aom:hub.aom,sup:hub.sup})] : [];
    });
  });
  return {sheets:sheets,hubCatalog:catalog,access:toPublicAccess_(access,getPermissionModel_(false)),generatedAt:new Date().toISOString()};
}
function getD0Snapshot(force, section) {
  if (section === 'hourly') return getD0HourlySnapshot(force);
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = d0SummarySnapshot_(workspaceD0Rows_(access,section));
  return section ? d0SnapshotSection_(snapshot,section) : snapshot;
}
// Separate RPC: independent of legacy D0 section registries and summary filters.
function getD0HourlySnapshot(force) {
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = workspaceD0NamedRows_(access,['Throughput Hourly D0']);
  snapshot.sheets['Throughput Hourly D0'] = d0HourlyRows_(snapshot.sheets['Throughput Hourly D0'] || []);
  return Object.assign({},snapshot,{section:'hourly',summaryOnly:true,cacheSeconds:60,apiVersion:'d0-hourly-v2'});
}
function getD0Riders(code,page,sort,direction,force,query) {
  const access = requireAccess_(['d0']);
  assertScopeAccess_(access,'HUB',code);
  const snapshot=workspaceD0Rows_(access,'delivery');
  return d0RiderPage_((snapshot.sheets['Delivery Progress D0']||[]).filter(function(r){return String(r.hub_code)===String(code)}),page,sort,direction,query);
}
function getAccessDirectory() {
  requireAdmin_();
  const settings=getAccessGrantSettings();
  return {users:settings.accounts,stations:settings.hubs,accounts:settings.accounts,hubs:settings.hubs};
}

