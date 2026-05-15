// ================================================================
//  flashlight.js — 手電筒系統（含 MTL 貼圖 + 旋轉 + Spotlight）
//
//  ★ 全域調整變數：
//    FLASHLIGHT_SCALE      — 模型縮放（預設 18.0）
//    FLASHLIGHT_SPOT_ANGLE — 聚光錐半角度數（預設 18.0）
//    FLASHLIGHT_RANGE      — 聚光最遠距離 world unit（預設 30.0）
//    FLASHLIGHT_INTENSITY  — 聚光亮度倍率（預設 2.5）
//    FLASHLIGHT_OFFSET     — view-space 偏移 {x右, y上, z前}
//    FLASHLIGHT_ROTATION   — 模型旋轉 {x, y, z} 度，繞各軸
//
//  依賴：cuon-matrix.js (Matrix4)、move.js (Move)
// ================================================================

// ── ★ 全域調整變數 ─────────────────────────────────────────────
var FLASHLIGHT_SCALE      = 5.0;
var FLASHLIGHT_SPOT_ANGLE = 30.0;
var FLASHLIGHT_RANGE      = 30.0;
var FLASHLIGHT_INTENSITY  = 5;
var FLASHLIGHT_OFFSET     = { x: 0.6, y: -0.35, z: -0.25 };
var FLASHLIGHT_ROTATION   = { x: 0.0,  y: 110.0,   z: 0.0  };
//   ↑ 度數，x = 仰俯（繞X軸）、y = 左右翻（繞Y軸）、z = 滾轉（繞Z軸）

// ── ★ 電量系統調整變數 ─────────────────────────────────────────
var FLASHLIGHT_BATTERY_MAX      = 100.0;  // 滿電量（%）
var FLASHLIGHT_DRAIN_RATE       = 0.5;    // 每秒耗電量（%），預設100%約66秒用完
var FLASHLIGHT_LOW_THRESHOLD    = 20.0;   // 低電量警告門檻（%）
var FLASHLIGHT_FLICKER_THRESHOLD= 8.0;   // 開始閃爍門檻（%）

// ── ★ Smiler 偵測調整變數 ──────────────────────────────────────
var FLASHLIGHT_SMILER_DOT_MIN   = 0.5;  // 視線對準度（cos值）：越高越需要對準中心
//   cos(23°)≈0.92，表示視線偏差不超過23度才算「對到」
var FLASHLIGHT_SMILER_MAX_DIST  = 15.0;  // 最遠偵測距離（world unit）
var FLASHLIGHT_SMILER_VANISH_SEC= 10.0;   // smiler 消失持續秒數
var FLASHLIGHT_SMILER_LIGHT_SEC = 1.0;   // 需要持續照射幾秒才觸發消失

var Flashlight = (function () {

    var BASE_DIR = 'backroom_object/flashlight/';

    // ── Shaders ────────────────────────────────────────────────
    var VS = `
        attribute vec3 a_Position;
        attribute vec3 a_Normal;
        attribute vec2 a_TexCoord;
        uniform mat4 u_MvpMatrix;
        uniform mat4 u_NormalMatrix;
        varying vec3 v_Normal;
        varying vec2 v_TexCoord;
        void main() {
            gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);
            v_Normal    = normalize((u_NormalMatrix * vec4(a_Normal, 0.0)).xyz);
            v_TexCoord  = a_TexCoord;
        }`;

    var FS = `
        precision mediump float;
        varying vec3      v_Normal;
        varying vec2      v_TexCoord;
        uniform sampler2D u_Sampler;
        uniform bool      u_HasTex;
        uniform vec3      u_BaseColor;
        uniform vec3      u_LightDir;
        void main() {
            vec3  base = u_HasTex ? texture2D(u_Sampler, v_TexCoord).rgb : u_BaseColor;
            vec3  n    = normalize(v_Normal);
            float d    = max(dot(n, u_LightDir), 0.0);
            vec3  col  = base * (0.4 + 0.6 * d);
            gl_FragColor = vec4(col, 1.0);
        }`;

    // ── 內部狀態 ───────────────────────────────────────────────
    var _gl     = null;
    var _prog   = null;
    var _loc    = {};
    var _groups = [];
    var _held   = false;
    var _ready  = false;

    // ── 電量狀態 ───────────────────────────────────────────────
    var _battery      = FLASHLIGHT_BATTERY_MAX;
    var _lastDrainTime= null;
    var _flickerState = true;
    var _flickerTimer = 0;

    // ── Smiler 清單與計時器 ────────────────────────────────────
    var _smilers = [];
    var _smilerLightTimers = new Map();
    var _lastFrameTime = null;
    var _debugTimer    = 0;

    // ── HUD DOM ────────────────────────────────────────────────
    var _hud = null;

    function _createHUD() {
        if (_hud) return;
        _hud = document.createElement('div');
        _hud.id = 'flashlight-hud';
        _hud.style.cssText = [
            'position:fixed','top:24px','right:24px','z-index:9999',
            'display:flex','flex-direction:column','align-items:flex-end',
            'gap:6px','pointer-events:none',
            'font-family:"Courier New",Courier,monospace',
            'transition:opacity 0.4s ease',
        ].join(';');

        var labelRow = document.createElement('div');
        labelRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
        var icon = document.createElement('span');
        icon.style.cssText = 'font-size:14px;filter:drop-shadow(0 0 4px #fff8);';
        icon.textContent = '🔦';
        labelRow.appendChild(icon);
        var label = document.createElement('span');
        label.style.cssText = 'color:#b8c4a0;font-size:10px;letter-spacing:3px;text-shadow:0 0 8px #4a6a2080;';
        label.textContent = 'BATTERY';
        labelRow.appendChild(label);
        _hud.appendChild(labelRow);

        var segRow = document.createElement('div');
        segRow.style.cssText = 'display:flex;gap:3px;align-items:center;';
        for (var i = 0; i < 10; i++) {
            var seg = document.createElement('div');
            seg.className = 'fl-seg';
            seg.style.cssText = 'width:10px;height:18px;border-radius:2px;border:1px solid #3a4a30;background:#0d1208;transition:background 0.15s,box-shadow 0.15s;';
            segRow.appendChild(seg);
        }
        _hud.appendChild(segRow);

        var bottomRow = document.createElement('div');
        bottomRow.style.cssText = 'display:flex;align-items:center;gap:8px;min-height:14px;';
        var pct = document.createElement('span');
        pct.id = 'flashlight-pct';
        pct.style.cssText = 'color:#7a9060;font-size:10px;letter-spacing:1px;min-width:36px;text-align:right;';
        pct.textContent = '100%';
        bottomRow.appendChild(pct);
        var warn = document.createElement('span');
        warn.id = 'flashlight-warn';
        warn.style.cssText = 'color:#ff5533;font-size:9px;font-weight:bold;letter-spacing:2px;text-shadow:0 0 10px #ff330080;display:none;';
        warn.textContent = '⚠ LOW';
        bottomRow.appendChild(warn);
        _hud.appendChild(bottomRow);

        document.body.appendChild(_hud);
    }

    function _updateHUD() {
        if (!_hud) return;
        var pct    = Math.max(0, Math.min(100, _battery));
        var pctEl  = document.getElementById('flashlight-pct');
        var warnEl = document.getElementById('flashlight-warn');
        var segs   = document.querySelectorAll('.fl-seg');
        if (!segs.length) return;

        var litCount = Math.ceil(pct / 10);
        for (var i = 0; i < segs.length; i++) {
            if (i < litCount) {
                var lvl = (i + 1) * 10;
                var bg = lvl > 50 ? '#4aff2a' : lvl > 20 ? '#ffc400' : '#ff3300';
                var sh = lvl > 50 ? '0 0 6px #4aff2a99' : lvl > 20 ? '0 0 6px #ffc40099' : '0 0 8px #ff3300bb';
                if (!_flickerState && pct <= FLASHLIGHT_FLICKER_THRESHOLD) { bg='#0d1208'; sh='none'; }
                segs[i].style.background  = bg;
                segs[i].style.boxShadow   = sh;
                segs[i].style.borderColor = bg;
            } else {
                segs[i].style.background  = '#0d1208';
                segs[i].style.boxShadow   = 'none';
                segs[i].style.borderColor = '#2a3a22';
            }
        }
        if (pctEl) {
            pctEl.textContent = Math.ceil(pct) + '%';
            pctEl.style.color = pct <= FLASHLIGHT_LOW_THRESHOLD ? '#ff5533' : pct <= 50 ? '#ccaa00' : '#7a9060';
        }
        if (warnEl) {
            warnEl.style.display = (pct <= FLASHLIGHT_LOW_THRESHOLD) ? 'inline' : 'none';
            warnEl.style.animation = 'fl-blink 0.8s infinite';
        }
        _hud.style.opacity = '1';
    }

    // ── GL 工具 ────────────────────────────────────────────────
    function _compile(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error('[Flashlight] shader: ' + gl.getShaderInfoLog(s));
        return s;
    }
    function _buildProg(gl) {
        var p = gl.createProgram();
        gl.attachShader(p, _compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(p, _compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error('[Flashlight] link: ' + gl.getProgramInfoLog(p));
        return p;
    }
    function _mkBuf(gl, data) {
        var b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return b;
    }
    function _loadTex(gl, url) {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([50, 50, 50, 255]));
        var img = new Image();
        img.onload = function () {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        };
        img.onerror = function () { console.warn('[Flashlight] 貼圖找不到:', url); };
        img.src = url;
        return tex;
    }

    // ── MTL 解析 ──────────────────────────────────────────────
    function _parseMTL(text) {
        var mats = {}, cur = null;
        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line[0] === '#') return;
            var p = line.split(/\s+/);
            switch (p[0]) {
                case 'newmtl': cur = {}; mats[p[1]] = cur; break;
                case 'Kd': if (cur) cur.Kd = [+p[1], +p[2], +p[3]]; break;
                case 'map_Kd': if (cur) cur.map_Kd = p.slice(1).join(' '); break;
            }
        });
        return mats;
    }

    // ── OBJ 解析 ──────────────────────────────────────────────
    function _parseOBJ(text) {
        var posPool = [], uvPool = [], nrmPool = [];
        var groups = [], cur = null;
        function newGroup(mat) {
            cur = { matName: mat, positions: [], uvs: [], normals: [] };
            groups.push(cur);
        }
        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line[0] === '#') return;
            var p = line.split(/\s+/);
            switch (p[0]) {
                case 'v': posPool.push(+p[1], +p[2], +p[3]); break;
                case 'vt': uvPool.push(+p[1], 1.0 - +p[2]); break;
                case 'vn': nrmPool.push(+p[1], +p[2], +p[3]); break;
                case 'usemtl': newGroup(p[1]); break;
                case 'f': {
                    if (!cur) newGroup('__default__');
                    var verts = p.slice(1).map(function (s) {
                        var idx = s.split('/').map(function (x) { return parseInt(x) - 1; });
                        return { vi: idx[0], ti: idx[1], ni: idx[2] };
                    });
                    for (var i = 1; i < verts.length - 1; i++) {
                        [verts[0], verts[i], verts[i + 1]].forEach(function (v) {
                            cur.positions.push(posPool[v.vi * 3], posPool[v.vi * 3 + 1], posPool[v.vi * 3 + 2]);
                            cur.uvs.push(
                                v.ti >= 0 ? uvPool[v.ti * 2] : 0,
                                v.ti >= 0 ? uvPool[v.ti * 2 + 1] : 0);
                            cur.normals.push(
                                v.ni >= 0 ? nrmPool[v.ni * 3] : 0,
                                v.ni >= 0 ? nrmPool[v.ni * 3 + 1] : 1,
                                v.ni >= 0 ? nrmPool[v.ni * 3 + 2] : 0);
                        });
                    }
                    break;
                }
            }
        });
        return groups;
    }

    function _fetch(url, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) cb(xhr.responseText);
            else console.warn('[Flashlight] 載入失敗:', url, xhr.status);
        };
        xhr.onerror = function () { console.warn('[Flashlight] XHR 錯誤:', url); };
        xhr.send();
    }

    // ================================================================
    //  init
    // ================================================================
    function init(glCtx) {
        _gl = glCtx;

        // ★ 重啟修正：刪除舊的 WebGL shader program，避免累積洩漏
        if (_prog) {
            _gl.deleteProgram(_prog);
            _prog = null;
        }

        // ★ 重啟修正：釋放舊的 WebGL buffer（手電筒模型）
        _groups.forEach(function (g) {
            _gl.deleteBuffer(g.bufPos);
            _gl.deleteBuffer(g.bufUV);
            _gl.deleteBuffer(g.bufNrm);
            if (g.tex) _gl.deleteTexture(g.tex);
        });

        // ★ 重生時完整重置所有狀態
        _prog = _buildProg(glCtx);
        _groups = [];
        _ready  = false;
        _held   = false;

        // 電量重置
        _battery       = FLASHLIGHT_BATTERY_MAX;
        _lastDrainTime = null;
        _flickerState  = true;
        _flickerTimer  = 0;

        // Smiler 狀態重置（_smilers 由 clearSmilers() 在 main() 清空）
        _lastFrameTime = null;
        _debugTimer    = 0;
        _smilerLightTimers.clear();

        _loc.a_Position   = glCtx.getAttribLocation(_prog, 'a_Position');
        _loc.a_Normal     = glCtx.getAttribLocation(_prog, 'a_Normal');
        _loc.a_TexCoord   = glCtx.getAttribLocation(_prog, 'a_TexCoord');
        _loc.u_MvpMatrix  = glCtx.getUniformLocation(_prog, 'u_MvpMatrix');
        _loc.u_NormalMatrix= glCtx.getUniformLocation(_prog, 'u_NormalMatrix');
        _loc.u_Sampler    = glCtx.getUniformLocation(_prog, 'u_Sampler');
        _loc.u_HasTex     = glCtx.getUniformLocation(_prog, 'u_HasTex');
        _loc.u_BaseColor  = glCtx.getUniformLocation(_prog, 'u_BaseColor');
        _loc.u_LightDir   = glCtx.getUniformLocation(_prog, 'u_LightDir');

        _createHUD();
        // ★ 確保 HUD 顯示（可能被上一局回選單時隱藏了）
        if (_hud) _hud.style.display = '';
        _updateHUD();   // ★ 初始化後立刻渲染，不等第一次互動

        // 防止重複綁定 keydown（只綁一次）
        if (!Flashlight._keyBound) {
            Flashlight._keyBound = true;
            document.addEventListener('keydown', function (e) {
                var KB = window._keyBindings || {};
                var flashKey = KB.flashlight || 'KeyF';
                if (e.code === flashKey) {
                    _held = !_held;
                    console.log('[Flashlight]', _held ? '拾起手電筒' : '放下手電筒');
                    _updateHUD();
                }
            });
        }

        _fetch(BASE_DIR + 'flashlight.mtl', function (mtlText) {
            var materials = _parseMTL(mtlText);
            var texMap = {};
            Object.keys(materials).forEach(function (name) {
                if (materials[name].map_Kd)
                    texMap[name] = _loadTex(glCtx, BASE_DIR + materials[name].map_Kd);
            });
            _fetch(BASE_DIR + 'flashlight.obj', function (objText) {
                var groups = _parseOBJ(objText);
                groups.forEach(function (g) {
                    if (!g.positions.length) return;
                    var mat = materials[g.matName] || {};
                    _groups.push({
                        bufPos   : _mkBuf(glCtx, g.positions),
                        bufUV    : _mkBuf(glCtx, g.uvs),
                        bufNrm   : _mkBuf(glCtx, g.normals),
                        count    : g.positions.length / 3,
                        tex      : texMap[g.matName] || null,
                        hasTex   : !!texMap[g.matName],
                        baseColor: mat.Kd || [0.85, 0.85, 0.85],
                    });
                });
                _ready = true;
                console.log('[Flashlight] 載入完成，群組數:', _groups.length);
            });
        });
    }

    // ================================================================
    //  _updateBattery — 耗電 + 閃爍邏輯
    // ================================================================
    function _updateBattery(dt) {
        if (!_held) {
            _lastDrainTime = null;
            return;
        }
        if (_battery <= 0) {
            _battery = 0;
            _updateHUD();
            return;
        }

        _battery -= FLASHLIGHT_DRAIN_RATE * dt;
        if (_battery < 0) _battery = 0;

        if (_battery <= FLASHLIGHT_FLICKER_THRESHOLD && _battery > 0) {
            _flickerTimer += dt;
            var period = 0.08 + (_battery / FLASHLIGHT_FLICKER_THRESHOLD) * 0.25;
            if (_flickerTimer >= period) {
                _flickerTimer = 0;
                _flickerState = !_flickerState;
            }
        } else {
            _flickerState = true;
            _flickerTimer = 0;
        }

        _updateHUD();
    }

    // ================================================================
    //  _checkSmilers — 偵測視線是否對準 smiler，累積照射秒數後消失
    // ================================================================
    function _checkSmilers(eyePos, fwd, dt) {
        var ex = eyePos[0], ey = eyePos[1], ez = eyePos[2];

        for (var i = 0; i < _smilers.length; i++) {
            var npc = _smilers[i];
            if (!npc) continue;
            if (!npc.cfg || npc.cfg.type !== 'smiler') continue;

            // 已消失中：重置計時，等待重現
            if (npc.isVanished && npc.isVanished()) {
                _smilerLightTimers.set(npc, 0);
                continue;
            }

            var p    = npc.getPos();
            var dx   = p.x - ex;
            var dy   = p.y - ey;
            var dz   = p.z - ez;
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // 超出範圍：重置計時
            if (dist > FLASHLIGHT_SMILER_MAX_DIST || dist < 0.01) {
                _smilerLightTimers.set(npc, 0);
                continue;
            }

            var tx  = dx / dist, ty = dy / dist, tz = dz / dist;
            var dot = fwd.x * tx + fwd.y * ty + fwd.z * tz;

            if (dot >= FLASHLIGHT_SMILER_DOT_MIN) {
                // 在聚光錐內，累積計時
                var t = (_smilerLightTimers.get(npc) || 0) + dt;
                _smilerLightTimers.set(npc, t);
                if (t >= FLASHLIGHT_SMILER_LIGHT_SEC) {
                    _smilerLightTimers.set(npc, 0);
                    if (typeof npc.vanish === 'function') {
                        npc.vanish(FLASHLIGHT_SMILER_VANISH_SEC);
                    }
                }
            } else {
                // 視線移開：重置計時
                _smilerLightTimers.set(npc, 0);
            }
        }
    }

    // ================================================================
    //  updateSmilers — 每幀由 loop() 直接呼叫
    // ================================================================
    function _updateSmilers() {
        if (_smilers.length === 0) return;

        var now = performance.now();
        var dt  = _lastFrameTime ? (now - _lastFrameTime) / 1000 : 0;
        dt = Math.min(dt, 0.1);
        _lastFrameTime = now;

        // 沒拿、沒電、閃爍暗相 → 清除計時，不偵測
        var hasPower = _held && (_battery > 0) && _flickerState;
        if (!hasPower) {
            _smilerLightTimers.clear();
            return;
        }

        // ★ 取眼睛位置：直接從全域 _sharedLight 讀（main.js 每幀更新）
        if (typeof _sharedLight === 'undefined' || !_sharedLight.eyePos) return;
        var ep = _sharedLight.eyePos;

        var fwd = Move.getForward();

        // ★ DEBUG：每 2 秒印一次，方便排查
        _debugTimer += dt;
        if (_debugTimer >= 2.0) {
            _debugTimer = 0;
            console.log('[FL-DEBUG] smilers:', _smilers.length,
                '| eye:', ep[0].toFixed(2), ep[1].toFixed(2), ep[2].toFixed(2),
                '| fwd:', fwd.x.toFixed(2), fwd.y.toFixed(2), fwd.z.toFixed(2),
                '| battery:', _battery.toFixed(1));
            _smilers.forEach(function (n, i) {
                var p = n.getPos();
                var dx = p.x - ep[0], dy = p.y - ep[1], dz = p.z - ep[2];
                var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                var dot  = dist > 0.01
                    ? (fwd.x*(dx/dist) + fwd.y*(dy/dist) + fwd.z*(dz/dist))
                    : -1;
                console.log('  ['+i+'] pos:('+p.x.toFixed(1)+','+p.z.toFixed(1)+')'
                    +' dist:'+dist.toFixed(1)+' dot:'+dot.toFixed(3)
                    +' vanished:'+n.isVanished()
                    +' acc:'+(_smilerLightTimers.get(n)||0).toFixed(2)+'s');
            });
        }

        _checkSmilers(ep, fwd, dt);
    }

    // ================================================================
    //  render — loop() 末尾呼叫，只負責渲染手電筒模型
    // ================================================================
    function render(projMat, viewMat) {
        // 電量更新（不管有沒有拿都要算 dt，才能在拿起時立刻正確耗電）
        var now = performance.now();
        var dt  = _lastDrainTime ? (now - _lastDrainTime) / 1000 : 0.016;
        dt = Math.min(dt, 0.1);
        _lastDrainTime = now;
        _updateBattery(dt);

        // 沒拿或模型未就緒就不渲染
        if (!_held || !_ready || !_gl || !_prog) return;

        var hasPower = (_battery > 0) && _flickerState;

        var gl = _gl;
        gl.useProgram(_prog);
        gl.enable(gl.DEPTH_TEST);

        var localMat = new Matrix4();
        localMat.setTranslate(FLASHLIGHT_OFFSET.x, FLASHLIGHT_OFFSET.y, FLASHLIGHT_OFFSET.z);
        localMat.rotate(FLASHLIGHT_ROTATION.z, 0, 0, 1);
        localMat.rotate(FLASHLIGHT_ROTATION.x, 1, 0, 0);
        localMat.rotate(FLASHLIGHT_ROTATION.y, 0, 1, 0);
        localMat.scale(FLASHLIGHT_SCALE, FLASHLIGHT_SCALE, FLASHLIGHT_SCALE);

        var invView = new Matrix4(viewMat);
        invView.invert();
        var modelMat = new Matrix4(invView);
        modelMat.multiply(localMat);

        var normMat = new Matrix4();
        normMat.setInverseOf(modelMat);
        normMat.transpose();

        var mvp = new Matrix4(projMat);
        mvp.multiply(viewMat);
        mvp.multiply(modelMat);

        gl.uniformMatrix4fv(_loc.u_MvpMatrix,    false, mvp.elements);
        gl.uniformMatrix4fv(_loc.u_NormalMatrix, false, normMat.elements);

        if (hasPower) {
            gl.uniform3fv(_loc.u_LightDir, [0.4, 0.8, 0.4]);
        } else {
            gl.uniform3fv(_loc.u_LightDir, [0.05, 0.05, 0.05]);
        }
        gl.uniform1i(_loc.u_Sampler, 0);
        gl.activeTexture(gl.TEXTURE0);

        _groups.forEach(function (g) {
            gl.bindBuffer(gl.ARRAY_BUFFER, g.bufPos);
            gl.enableVertexAttribArray(_loc.a_Position);
            gl.vertexAttribPointer(_loc.a_Position, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, g.bufUV);
            gl.enableVertexAttribArray(_loc.a_TexCoord);
            gl.vertexAttribPointer(_loc.a_TexCoord, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, g.bufNrm);
            gl.enableVertexAttribArray(_loc.a_Normal);
            gl.vertexAttribPointer(_loc.a_Normal, 3, gl.FLOAT, false, 0, 0);

            gl.uniform1i(_loc.u_HasTex, g.hasTex ? 1 : 0);
            gl.uniform3fv(_loc.u_BaseColor, g.baseColor);
            if (g.tex) gl.bindTexture(gl.TEXTURE_2D, g.tex);

            gl.drawArrays(gl.TRIANGLES, 0, g.count);
        });
    }

    // ================================================================
    //  getSpotUniforms — Stage.render() 裡呼叫，傳入 spotlight 參數
    // ================================================================
    function getSpotUniforms() {
        if (!_held) return { held: false };
        if (_battery <= 0 || !_flickerState) return { held: false };
        var ep  = (typeof _sharedLight !== 'undefined') ? _sharedLight.eyePos : [0, 0, 0];
        var fwd = Move.getForward();
        return {
            held:         true,
            spotPos:      ep,
            spotDir:      [fwd.x, fwd.y, fwd.z],
            spotCosOuter: Math.cos(FLASHLIGHT_SPOT_ANGLE * Math.PI / 180),
            spotRange:    FLASHLIGHT_RANGE,
            spotIntensity:FLASHLIGHT_INTENSITY,
        };
    }

    return {
        init,
        render,
        getSpotUniforms,
        // ── 每幀由 loop() 呼叫，處理 smiler 偵測 ─────────────────
        updateSmilers: _updateSmilers,
        // ── 手電筒狀態 ───────────────────────────────────────────
        isHeld:   function ()  { return _held; },
        setHeld:  function (v) { _held = v; _updateHUD(); },
        // ── 電量 API ─────────────────────────────────────────────
        getBattery:  function ()    { return _battery; },
        setBattery:  function (v)   { _battery = Math.max(0, Math.min(FLASHLIGHT_BATTERY_MAX, v)); _updateHUD(); },
        hasPower:    function ()    { return _battery > 0; },
        // ── HUD 顯示控制（退出到主選單時呼叫 hideHUD）───────────
        hideHUD: function () { if (_hud) _hud.style.display = 'none'; },
        showHUD: function () { if (_hud) { _hud.style.display = ''; _updateHUD(); } },
        // ── Smiler 管理 ──────────────────────────────────────────
        registerSmiler:   function (npc) { _smilers.push(npc); },
        unregisterSmiler: function (npc) {
            var idx = _smilers.indexOf(npc);
            if (idx !== -1) _smilers.splice(idx, 1);
        },
        clearSmilers: function () {
            _smilers = [];
            _smilerLightTimers.clear();
            _lastFrameTime = null;
        },
    };

})();