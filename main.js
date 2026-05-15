// ================================================================
//  main.js — 全域變數 & 程式主邏輯
//  修改：整合 physics.js + npc.js（多怪物版）
// ================================================================

// ================================================================
//  ★★★  全域調整區（改這裡就夠了）  ★★★
// ================================================================

// ── 遊戲模式 ────────────────────────────────────────────────────
var piece = false;          // true = 和平模式（不生成任何怪物）

// ── 怪物種類開關 ────────────────────────────────────────────────
var onSkinstealer = true;
var onBackteria = true;
var onPartygeor = true;
var onSmiler = true;

// ── 死亡視角仰角（正值=往上看，負值=往下） ─────────────────────
var DEAD_EYE_Y = 70;

// ── 各怪物共用數值（修改這裡會套用到 NPC_SPAWN_LIST 所有同類） ─
//    個別怪物若想覆蓋，直接在 NPC_SPAWN_LIST 裡補同名欄位即可

var NPC_DEFAULTS = {
    skinstealer: {
        scale: 150.0,
        runScale: 0.3,
        speed: 0.02,
        chaseSpeed: 0.08,
        chaseDist: 12.0,
        catchDist: 1.5,
        eyeY: 3.5,
        animSpeed: 0.8,
        chaseAnimSpeed: 0.8,
        baseColor: [0.85, 0.78, 0.55],
        nightOnly: false,
    },
    backteria: {
        scale: 0.00015,
        runScale: 0.00015,
        speed: 0.02,
        chaseSpeed: 0.05,
        chaseDist: 15.0,
        catchDist: 1.5,
        eyeY: 2.5,
        animSpeed: 0.8,
        chaseAnimSpeed: 0.8,
        baseColor: [0.0, 0.0, 0.0],
        nightOnly: false,
    },
    partygeor: {
        scale: 0.02,
        runScale: 0.02,
        speed: 0.001,
        chaseSpeed: 0.05,
        chaseDist: 10.0,
        catchDist: 1.5,
        eyeY: 2.5,
        animSpeed: 0.8,
        chaseAnimSpeed: 0.8,
        baseColor: [0.45, 0.38, 0.15],
        nightOnly: false,
    },
    smiler: {
        scale: 0.0022,
        runScale: 0.0022,
        speed: 0.001,
        chaseSpeed: 0.02,
        chaseDist: 15.0,
        catchDist: 3.5,
        eyeY: 2.2,
        animSpeed: 0.8,
        chaseAnimSpeed: 0.8,
        baseColor: [0.0, 0.0, 0.0],
        nightOnly: true,
    },
};

// ── 出生點（由 _onMapLoaded 覆寫，這裡是備用預設值） ───────────
var _spawnPos = { x: 2.5, y: 1.7, z: 7.0 };

// ================================================================
//  ★★★  怪物出生位置清單  ★★★
//
//  每筆只需填 type + 座標（posX/posY/posZ）。
//  其他數值會自動從 NPC_DEFAULTS[type] 繼承。
//  若要針對某隻個別調整，直接在該物件裡補欄位即可，例如：
//    { type: 'smiler', posX: 21, posY: 0, posZ: 22, catchDist: 3.5 }
// ================================================================
var NPC_SPAWN_LIST = [
    // ── Skinstealer ──────────────────────────────────────────────
    {
        type: 'skinstealer', posX: 47.0, posY: 0.0, posZ: 22.0,
        walkDir: 'backroom_charactors/skinstealer/skinstealer_Walking/',
        runDir: 'backroom_charactors/skinstealer/skinstealer_Running/'
    },
    {
        type: 'skinstealer', posX: 37.0, posY: 0.0, posZ: -44.0,
        walkDir: 'backroom_charactors/skinstealer/skinstealer_Walking/',
        runDir: 'backroom_charactors/skinstealer/skinstealer_Running/'
    },

    // ── Backteria ─────────────────────────────────────────────────
    {
        type: 'backteria', posX: -11.0, posY: 0.0, posZ: 20.0,
        walkDir: 'backroom_charactors/backteria/backteria_Walking/',
        runDir: 'backroom_charactors/backteria/backteria_Running/'
    },

    // ── Partygeor ─────────────────────────────────────────────────
    {
        type: 'partygeor', posX: 3.0, posY: 0.0, posZ: -4.0,
        walkDir: 'backroom_charactors/partygeor_1/partygeor_Walking/',
        runDir: 'backroom_charactors/partygeor_1/partygeor_Running/'
    },
    {
        type: 'partygeor', posX: 19.0, posY: 0.0, posZ: 0.0,
        walkDir: 'backroom_charactors/partygeor_0/partygeor_Walking/',
        runDir: 'backroom_charactors/partygeor_0/partygeor_Running/'
    },

    // ── Smiler ────────────────────────────────────────────────────
    {
        type: 'smiler', posX: 55.0, posY: 0.0, posZ: -3.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -5.0, posY: 0.0, posZ: 34.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 21.0, posY: 0.0, posZ: 22.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 36.0, posY: 0.0, posZ: 7.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 38.0, posY: 0.0, posZ: -15.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -33.0, posY: 0.0, posZ: 38.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -56.0, posY: 0.0, posZ: 26.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 16.0, posY: 0.0, posZ: 36.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 7.8, posY: 0.0, posZ: 24.6,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -23.0, posY: 0.0, posZ: 34.7,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -10.0, posY: 0.0, posZ: 17.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -25.0, posY: 0.0, posZ: 20.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: -46.0, posY: 0.0, posZ: 22.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 37.0, posY: 0.0, posZ: 22.6,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 57.0, posY: 0.0, posZ: 29.0,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 27.8, posY: 0.0, posZ: -1.5,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 7.4, posY: 0.0, posZ: -14.3,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 18.5, posY: 0.0, posZ: 2.6,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 37.7, posY: 0.0, posZ: -29.4,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 56.0, posY: 0.0, posZ: -23.6,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },
    {
        type: 'smiler', posX: 38.8, posY: 0.0, posZ: -45.3,
        walkDir: 'backroom_charactors/smiler/smiler_Walking/',
        runDir: 'backroom_charactors/smiler/smiler_Running/'
    },

    // 新增怪物只要加一行，例如：
    // { type: 'skinstealer', posX: 0.0, posY: 0.0, posZ: 0.0,
    //   walkDir: 'backroom_charactors/XXX/XXX_Walking/',
    //   runDir:  'backroom_charactors/XXX/XXX_Running/' },
];

// ================================================================
//  ↓↓↓  以下不需要改動  ↓↓↓
// ================================================================

// ── 全域變數 ────────────────────────────────────────────────────
var canvas = null;
var gl = null;
var projMat = null;

// 怪物清單（由 spawnNPCs 填入）
var _npcs = [];

// ── 死亡狀態 ────────────────────────────────────────────────────
var _isDead = false;
var _killerNPC = null;

// ── loop 控制 ────────────────────────────────────────────────────
var _loopRunning = false;

// onPlayerCaught — 由 npc.js 呼叫，啟動死亡演出
function onPlayerCaught(npc) {
    if (_isDead) return;
    _isDead = true;
    _killerNPC = npc;
    Dead.trigger(npc);
}

// 共享給 NPC 的每幀光影狀態
var _sharedLight = {
    eyePos: [0, 0, 0],
    lightPos: [0, 0, 0],
    ambientColor: [0.38, 0.34, 0.24],
    lightColor: [1.0, 0.95, 0.82],
};

var _sharedViewMat = null;
var _lastTime = 0;

// ================================================================
//  _mergeDefaults — 將 NPC_DEFAULTS[type] 與個別設定合併
//  個別設定的欄位優先（覆蓋 defaults）
// ================================================================
function _mergeDefaults(cfg) {
    var def = NPC_DEFAULTS[cfg.type] || {};
    var merged = {};
    // 先複製 defaults
    for (var k in def) merged[k] = def[k];
    // 再用個別設定覆蓋
    for (var k in cfg) merged[k] = cfg[k];
    return merged;
}

// ================================================================
//  spawnNPCs — 依照 NPC_SPAWN_LIST 建立所有怪物實例
// ================================================================
function spawnNPCs(glCtx) {
    if (piece) {
        console.log('[main] piece = true，跳過怪物生成');
        return;
    }

    var typeSwitch = {
        skinstealer: onSkinstealer,
        backteria: onBackteria,
        partygeor: onPartygeor,
        smiler: onSmiler,
    };

    for (var i = 0; i < NPC_SPAWN_LIST.length; i++) {
        var rawCfg = NPC_SPAWN_LIST[i];
        if (typeSwitch[rawCfg.type] === false) continue;
        var cfg = _mergeDefaults(rawCfg);
        var npc = createNPC(cfg);
        npc.init(glCtx);
        _npcs.push(npc);
    }
    console.log('[main] 生成怪物數量:', _npcs.length);
}

// ================================================================
//  main — 由 <body onload="main()"> 呼叫
// ================================================================
function main() {
    // ── 停止上一輪的 loop（重新開始時防止雙 loop）────────────────
    _loopRunning = false;

    // ── 重置遊戲狀態 ───────────────────────────────────────────────
    _isDead = false;
    _killerNPC = null;
    _npcs = [];          // 清空怪物清單，避免累積

    canvas = document.getElementById('glCanvas');
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

    projMat = new Matrix4();
    if (!gl) { alert('WebGL not supported'); return; }

    Move.init(canvas, document.body, projMat);
    Stage.init(canvas, _onMapLoaded);
    Physics.init([]);

    // ★ 先初始化 Flashlight 並清空 smiler 清單，再生成怪物
    //    避免 init() 與 clearSmilers() 之間有殘留舊 NPC 參照被 updateSmilers() 讀到
    Flashlight.init(gl);
    Flashlight.clearSmilers();

    spawnNPCs(gl);
    Paper.init(gl);

    // 將新生成的 smiler 註冊進 Flashlight
    for (var i = 0; i < _npcs.length; i++) {
        if (_npcs[i].cfg.type === 'smiler') {
            Flashlight.registerSmiler(_npcs[i]);
        }
    }
    // Victor：若已初始化過則只重置狀態，否則完整初始化
    if (typeof Victor !== 'undefined') {
        if (document.getElementById('victor-ui')) {
            Victor.reset();   // 只清狀態，不重建 DOM
        } else {
            Victor.init();    // 第一次進入，完整初始化
        }
    }

    _loopRunning = true;
    _lastTime = performance.now();

    // ★ 音效：遊戲開始，依日夜狀態播放背景音效
    if (typeof AudioManager !== 'undefined') AudioManager.onGameStart();

    loop();
}

// ================================================================
//  _onMapLoaded — Stage 地圖載入完成後呼叫
// ================================================================
function _onMapLoaded(groups, scale) {
    Physics.setGeometry(groups, scale);
    var sx = 2.5 * scale, sy = 1.7, sz = 7 * scale;
    _spawnPos = { x: sx, y: sy, z: sz };
    Move.setPos(sx, sy, sz);
}

// ================================================================
//  _buildViewMat — 根據 Move 狀態建立 view matrix
// ================================================================
function _buildViewMat(playerPos) {
    var theta = Move.getTheta() * Math.PI / 180;
    var phi = Move.getPhi() * Math.PI / 180;

    var sinT = Math.sin(theta), cosT = Math.cos(theta);
    var sinP = Math.sin(phi), cosP = Math.cos(phi);

    var fwdX = cosP * sinT;
    var fwdY = sinP;
    var fwdZ = -cosP * cosT;

    var dist = Move.getDist();
    var eyeX = playerPos.x - fwdX * dist;
    var eyeY = playerPos.y - fwdY * dist;
    var eyeZ = playerPos.z - fwdZ * dist;

    var cX = playerPos.x + fwdX * (1 - dist);
    var cY = playerPos.y + fwdY * (1 - dist);
    var cZ = playerPos.z + fwdZ * (1 - dist);

    var upX = 0, upY = 1, upZ = 0;
    if (Math.abs(sinP) > 0.999) {
        upX = -sinT * sinP;
        upY = cosP;
        upZ = cosT * sinP;
    }

    var vm = new Matrix4();
    vm.setLookAt(eyeX, eyeY, eyeZ, cX, cY, cZ, upX, upY, upZ);

    _sharedLight.eyePos = [eyeX, eyeY, eyeZ];
    _sharedLight.lightPos = [playerPos.x, playerPos.y, playerPos.z];

    return vm;
}

// ================================================================
//  loop
// ================================================================
function loop() {
    if (!_loopRunning) return;

    // 暫停中：只繼續排隊下一幀，不更新遊戲邏輯
    // ★ 重啟修正：Victor.update() 也移到 pause check 之後，
    //   避免暫停選單開著時 hint canvas 仍被繪製並蓋住暫停 UI
    if (typeof PauseManager !== 'undefined' && PauseManager.isPaused()) {
        requestAnimationFrame(loop);
        return;
    }

    Victor.update(projMat, _sharedViewMat);

    if (_isDead) {
        Dead.update();

        _sharedViewMat = _buildViewMat(Move.getPos());
        Stage.render(Move.getPos(), projMat);

        var ep = _sharedLight.eyePos;
        var eyeAsPos = { x: ep[0], y: ep[1], z: ep[2] };
        var isNight = Stage.isNight();
        for (var i = 0; i < _npcs.length; i++) {
            if (_npcs[i].cfg.nightOnly && !isNight) continue;
            _npcs[i].render(Move.getPos(), projMat, _sharedViewMat, _sharedLight);
        }
        Flashlight.updateSmilers();
        Flashlight.render(projMat, _sharedViewMat);
        Paper.render(projMat, _sharedViewMat, _sharedLight);

        requestAnimationFrame(loop);
        return;
    }

    var playerPos = Move.getPos();

    Move.update();
    Physics.update();

    _sharedViewMat = _buildViewMat(Move.getPos());

    Stage.render(Move.getPos(), projMat);

    _sharedLight.lightColor = Stage.isNight()
        ? (Math.random() < 0.01 ? [1.0, 0.95, 0.82] : [0.0, 0.0, 0.0])
        : [1.0, 0.95, 0.82];

    var ep = _sharedLight.eyePos;
    var eyeAsPos = { x: ep[0], y: ep[1], z: ep[2] };

    var isNight = Stage.isNight();
    for (var i = 0; i < _npcs.length; i++) {
        if (_npcs[i].cfg.nightOnly && !isNight) continue;
        _npcs[i].update(eyeAsPos);
        _npcs[i].render(Move.getPos(), projMat, _sharedViewMat, _sharedLight);
    }

    // ★ 音效：每幀更新日夜 / 追擊狀態
    if (typeof AudioManager !== 'undefined') AudioManager.update(isNight, _npcs);

    Flashlight.updateSmilers();

    Flashlight.render(projMat, _sharedViewMat);
    Paper.render(projMat, _sharedViewMat, _sharedLight);

    requestAnimationFrame(loop);
}