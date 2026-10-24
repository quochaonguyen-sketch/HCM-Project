/**
 * SPX Performance Control Center — V0.17.29
 * FAST WORKSPACE BOOT SNAPSHOT
 *
 * doGet() never scans business sheets. A successful authorized workspace
 * bootstrap is saved per-user in UserCache + UserProperties and reused on
 * future page loads. Data APIs still enforce server-side permission.
 */
const FAST_BOOT_CFG = Object.freeze({
  CACHE_PREFIX:'spx:workspace-boot:r2',
  UI_BUILD:'2026.10.16-r143',
  USER_PROP_PREFIX:'SPX_FAST_BOOT_V01729',
  CACHE_TTL_SEC:21600,
  PROP_CHUNK_CHARS:8000
});

function fastBootCacheKey_(email) {
  return [FAST_BOOT_CFG.CACHE_PREFIX,FAST_BOOT_CFG.UI_BUILD,getSecurityVersion_(),PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID')||'',Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'),normalizeEmail_(email)].join(':');
}
function fastBootUserPropKey_(suffix) {
  return FAST_BOOT_CFG.USER_PROP_PREFIX + ':' + suffix;
}
function removeFastBootUserProps_() {
  const props=PropertiesService.getUserProperties();
  let count=0;
  try {
    const raw=props.getProperty(fastBootUserPropKey_('meta'));
    const meta=raw?JSON.parse(raw):null;
    count=meta?Number(meta.chunks||0):0;
  } catch(_) {}
  try { props.deleteProperty(fastBootUserPropKey_('meta')); } catch(_) {}
  for(let i=0;i<count;i++) {
    try { props.deleteProperty(fastBootUserPropKey_('c:'+i)); } catch(_) {}
  }
}
function putFastBootUserProps_(email,boot) {
  email=normalizeEmail_(email);
  if(!email||!boot||!boot.ready) return false;
  const envelope={
    securityVersion:getSecurityVersion_(),
    email:email,
    savedAt:new Date().toISOString(),
    boot:boot
  };
  const json=JSON.stringify(envelope);
  const chunks=[];
  for(let i=0;i<json.length;i+=FAST_BOOT_CFG.PROP_CHUNK_CHARS) {
    chunks.push(json.substring(i,i+FAST_BOOT_CFG.PROP_CHUNK_CHARS));
  }
  const props=PropertiesService.getUserProperties();
  removeFastBootUserProps_();
  chunks.forEach(function(chunk,i){
    props.setProperty(fastBootUserPropKey_('c:'+i),chunk);
  });
  props.setProperty(fastBootUserPropKey_('meta'),JSON.stringify({
    chunks:chunks.length,
    securityVersion:getSecurityVersion_(),
    email:email,
    savedAt:envelope.savedAt
  }));
  return true;
}
function getFastBootUserProps_(email) {
  email=normalizeEmail_(email);
  if(!email) return null;
  const props=PropertiesService.getUserProperties();
  let meta=null;
  try {
    const raw=props.getProperty(fastBootUserPropKey_('meta'));
    meta=raw?JSON.parse(raw):null;
  } catch(_) { return null; }
  if(!meta||!(Number(meta.chunks||0)>0)) return null;
  if(normalizeEmail_(meta.email)!==email) return null;
  if(String(meta.securityVersion||'')!==getSecurityVersion_()) return null;
  let json='';
  for(let i=0;i<Number(meta.chunks||0);i++) {
    const part=props.getProperty(fastBootUserPropKey_('c:'+i));
    if(part==null) return null;
    json+=part;
  }
  try {
    const envelope=JSON.parse(json);
    if(!envelope||!envelope.boot||!envelope.boot.ready) return null;
    if(normalizeEmail_(envelope.email)!==email) return null;
    if(String(envelope.securityVersion||'')!==getSecurityVersion_()) return null;
    return envelope.boot;
  } catch(_) { return null; }
}
function putFastBootSnapshot_(email,boot) {
  email=normalizeEmail_(email);
  if(!email||!boot||!boot.ready) return false;

  // Email-scoped chunked ScriptCache avoids the 100 KB single-entry limit
  // and avoids slow multi-property writes during secure login.
  try {
    putChunkedCacheJson_(
      fastBootCacheKey_(email),
      boot,
      FAST_BOOT_CFG.CACHE_TTL_SEC
    );
    return true;
  } catch(_) {
    return false;
  }
}
function getFastBootSnapshot_(email) {
  email=normalizeEmail_(email);
  if(!email) return null;
  if(workspaceSignedOut_(email))return null;

  try {
    const boot=getChunkedCacheJson_(fastBootCacheKey_(email));
    if(
      boot&&boot.ready&&
      normalizeEmail_(boot.user&&boot.user.email)===email
    ) {
      if(boot.app) boot.app.version=APP.VERSION;
      return boot;
    }
  } catch(_) {}

  return null;
}
function clearFastBootSnapshot_() {
  const email=getActiveEmail_();
  if(email) {
    try { removeChunkedCacheJson_(fastBootCacheKey_(email)); } catch(_) {}
  }
  // Clean old UserProperties snapshots from pre-V0.17.17 once an explicit
  // security refresh is requested; they are no longer used on login.
  try { removeFastBootUserProps_(); } catch(_) {}
  return true;
}
function buildWorkspaceBootstrapPayload_(access, permission) {
  const started =
    Date.now();

  const rank =
    normalizeRank_(
      access.rank
    );

  // NORMAL = external/configured modules only.
  // No Permission tree, KPI scope, HUB picker or KPI engine is required.
  if (rank === 'NORMAL') {
    const moduleView = {
      type:'MODULES',
      value:'',
      label:'Configured modules',
      hubCount:0,
      hubCodes:[]
    };

    return {
      ready:true,

      app:{
        name:APP.NAME,
        subtitle:APP.SUBTITLE,
        version:APP.VERSION
      },

      user:
        toPublicUser_(
          access
        ),

      access:
        toPublicAccess_(
          access,
          {
            stations:[],
            users:{}
          }
        ),

      scope:{
        rank:'NORMAL',
        defaultScope:
          moduleView,
        cityLabel:
          APP.CITY_LABEL,
        stationCount:0,
        moduleOnly:true
      },

      drill:{
        root:{
          level:'MODULES',
          value:'',
          label:'Configured modules',
          hubs:[]
        },
        hubs:[],
        aoms:[],
        saoms:[],
        defaultPath:{},
        defaultView:
          moduleView
      },

      kpi:{
        sheetFound:false,
        months:[],
        currentMonth:'',
        defaultMonth:'',
        metrics:[],
        lightweight:true,
        disabledForNormal:true
      },

      modules:
        getModuleNavigationForAccess_(
          access
        ),

      runtime:{
        bootstrapMs:
          Date.now() -
          started,
        bootSource:
          'SERVER_BUILD_NORMAL'
      },

      serverTime:
        new Date()
          .toISOString()
    };
  }

  const drill =
    buildDrillContext_(
      access,
      permission
    );

  const scope = {
    rank:
      normalizeRank_(
        access.rank
      ),

    defaultScope:
      drill.defaultView ||
      nodeToView_(
        drill.root
      ),

    cityLabel:
      APP.CITY_LABEL,

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

  return {
    ready:true,

    app:{
      name:APP.NAME,
      subtitle:APP.SUBTITLE,
      version:APP.VERSION
    },

    user:
      toPublicUser_(
        access
      ),

    access:
      toPublicAccess_(
        access,
        permission
      ),

    scope:scope,
    drill:drill,

    kpi:
      getLightweightKpiBootstrap_(),

    modules:
      getModuleNavigationForAccess_(
        access
      ),

    runtime:{
      bootstrapMs:
        Date.now() -
        started,
      bootSource:
        'SERVER_BUILD'
    },

    serverTime:
      new Date()
        .toISOString()
  };
}
function getWorkspaceBootstrapSnapshotOrBuild_(forceRefresh) {
  const email =
    getActiveEmail_();

  if (!email) {
    throw new Error(
      'AUTH_EMAIL_UNAVAILABLE'
    );
  }

  if(workspaceSignedOut_(email))return {ready:false,loggedOut:true};

  if (
    forceRefresh !== true
  ) {
    const cached =
      getFastBootSnapshot_(
        email
      );

    if (cached) {
      cached.runtime =
        cached.runtime || {};

      cached.runtime.bootSource =
        'USER_BOOT_SNAPSHOT';

      cached.runtime.snapshotHit =
        true;

      return cached;
    }

  } else {
    clearFastBootSnapshot_();

    // Managed Account index first.
    // ADMIN / NORMAL access should not wait for Permission parsing.
    getAdhocAdminIndex_(true);
  }

  const access =
    requireAccess_();

  // NORMAL accounts need only module settings.
  if (
    normalizeRank_(
      access.rank
    ) === 'NORMAL'
  ) {
    const boot =
      buildWorkspaceBootstrapPayload_(
        access,
        {
          sheetFound:true,
          sheetName:'Permission',
          stations:[],
          users:{},
          leadHeaders:[]
        }
      );

    boot.permissionStatus = {
      ok:true,
      skipped:true,
      reason:'NORMAL_MODULE_ONLY',
      sheetName:'Permission',
      stationCount:0,
      error:''
    };

    putFastBootSnapshot_(
      email,
      boot
    );

    return boot;
  }

  let permission;

  try {
    permission =
      getPermissionModel_(
        forceRefresh === true
      );

  } catch (err) {
    if (!access.isAdmin) {
      throw err;
    }

    permission = {
      sheetFound:false,
      sheetName:'Permission',
      generatedAt:
        new Date()
          .toISOString(),
      stations:[],
      users:{},
      leadHeaders:[],
      error:
        String(
          err &&
          err.message ||
          err
        )
    };
  }

  const boot =
    buildWorkspaceBootstrapPayload_(
      access,
      permission
    );

  boot.permissionStatus = {
    ok:
      permission.sheetFound !== false &&
      !permission.error,

    sheetName:
      permission.sheetName ||
      'Permission',

    stationCount:
      (
        permission.stations ||
        []
      ).length,

    error:
      permission.error || ''
  };

  putFastBootSnapshot_(
    email,
    boot
  );

  return boot;
}
function warmCurrentUserWorkspaceBootstrap_() {
  const email =
    getActiveEmail_();

  if (!email) {
    return {
      ok:false,
      reason:
        'AUTH_EMAIL_UNAVAILABLE'
    };
  }

  const access =
    requireAccess_();

  if (
    normalizeRank_(
      access.rank
    ) === 'NORMAL'
  ) {
    const boot =
      buildWorkspaceBootstrapPayload_(
        access,
        {
          sheetFound:true,
          stations:[],
          users:{}
        }
      );

    putFastBootSnapshot_(
      email,
      boot
    );

    return {
      ok:true,
      email:email,
      rank:'NORMAL',
      authSource:
        access.source || '',
      hubs:0,
      permissionOk:true,
      moduleOnly:true,
      savedAt:
        new Date()
          .toISOString()
    };
  }

  let permission;

  try {
    permission =
      getPermissionModel_(
        false
      );

  } catch (err) {
    if (!access.isAdmin) {
      throw err;
    }

    permission = {
      sheetFound:false,
      sheetName:'Permission',
      stations:[],
      users:{},
      error:
        String(
          err &&
          err.message ||
          err
        )
    };
  }

  const boot =
    buildWorkspaceBootstrapPayload_(
      access,
      permission
    );

  putFastBootSnapshot_(
    email,
    boot
  );

  return {
    ok:true,
    email:email,
    rank:access.rank,
    authSource:
      access.source || '',
    hubs:
      access.isAdmin
        ? (
            permission.stations ||
            []
          ).length
        : (
            access.hubCodes ||
            []
          ).length,
    permissionOk:
      !permission.error,
    savedAt:
      new Date()
        .toISOString()
  };
}
function debugFastBootstrapCache() {
  const email=getActiveEmail_();
  const boot=email?getFastBootSnapshot_(email):null;
  const out={
    ok:!!boot,email:email,securityVersion:getSecurityVersion_(),appVersion:APP.VERSION,
    bootReady:!!(boot&&boot.ready),
    bootSource:boot&&boot.runtime?(boot.runtime.bootSource||''):'',
    rank:boot&&boot.access?(boot.access.rank||''):'',
    stationCount:boot&&boot.scope?Number(boot.scope.stationCount||0):0
  };
  console.log(JSON.stringify(out,null,2));
  return out;
}
