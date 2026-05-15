// ================================================================
//  move.js — 攝影機視角 & 玩家移動管理
//  修改：Space → 跳躍（委派 Physics.queueJump）
//        Shift → 蹲下（委派 Physics.setCrouch）
//        移除直接 Y 軸移動（由 physics.js 接管）
// ================================================================
var Move = (function () {

    // ── 攝影機狀態 ─────────────────────────────────────────────
    var _theta = 0;        // 水平角（度）
    var _phi   = 0;        // 垂直角（度，-89 ~ 89）
    var _dist  = 0;        // 第三人稱距離（0 = 第一人稱）

    // ── 玩家世界座標 ───────────────────────────────────────────
    var _pos = { x: 2.5, y: 1.7, z: 7 };

    // ── 移動參數 ───────────────────────────────────────────────
    var NORMAL_SPEED = 0.05;
    var SPRINT_SPEED = 0.1;
    var MOUSE_SENS   = 0.15;   // 度/px
    var PHI_LIMIT    = 89;
    var THIRD_DIST   = 3;

    // ── 按鍵 & 狀態 ────────────────────────────────────────────
    var _keys        = {};
    var _crouching   = false;
    var _sprinting   = false;
    var _jumpQueued  = false;   // Space 按下時設為 true，由 Physics.consumeJump() 清除

    // ── Canvas / gameRoot 參照 ─────────────────────────────────
    var _canvas   = null;
    var _gameRoot = null;
    var _projMat  = null;    // 外部傳入的投影矩陣參照

    // ================================================================
    //  init — 綁定所有輸入事件
    //    canvas   : WebGL canvas 元素
    //    gameRoot : 全螢幕目標元素（通常是 document.body 或外層 div）
    //    projMat  : Matrix4，resize 時由 Move 直接更新
    // ================================================================
    function init(canvas, gameRoot, projMat) {
        _canvas   = canvas;
        _gameRoot = gameRoot;
        _projMat  = projMat;

        // Pointer Lock
        canvas.addEventListener('click', function () { canvas.requestPointerLock(); });
        document.addEventListener('pointerlockchange', _onLockChange);

        // 鍵盤
        document.addEventListener('keydown', _onKeyDown);
        document.addEventListener('keyup',   _onKeyUp);

        // 失焦清除按鍵（避免卡鍵）
        window.addEventListener('blur', _clearAll);

        // 全螢幕
        document.addEventListener('fullscreenchange', _onFullscreen);

        // Canvas resize
        window.addEventListener('resize', _onResize);
        _onResize();
    }

    // ================================================================
    //  update — 每幀呼叫，根據按鍵更新玩家 XZ 座標
    //  ★ Y 軸完全交由 physics.js 處理，這裡不再直接修改 _pos.y
    // ================================================================
    function update() {
        var speed = _sprinting ? SPRINT_SPEED : NORMAL_SPEED;

        // 蹲下時降速（可調整倍率）
        if (_crouching) speed *= 0.5;

        var fwd   = getForwardH();
        var right = getRight();

        // 讀取目前按鍵綁定（支援設定面板動態修改）
        var KB = window._keyBindings || {};
        var kFwd  = KB.forward  || 'KeyW';
        var kBack = KB.backward || 'KeyS';
        var kLeft = KB.left     || 'KeyA';
        var kRight= KB.right    || 'KeyD';

        if (_keys[kFwd]  || _keys['ArrowUp'])    { _pos.x += fwd.x   * speed; _pos.z += fwd.z   * speed; }
        if (_keys[kBack] || _keys['ArrowDown'])  { _pos.x -= fwd.x   * speed; _pos.z -= fwd.z   * speed; }
        if (_keys[kLeft] || _keys['ArrowLeft'])  { _pos.x -= right.x * speed; _pos.z -= right.z * speed; }
        if (_keys[kRight]|| _keys['ArrowRight']) { _pos.x += right.x * speed; _pos.z += right.z * speed; }

        // ★ 不再有 Space / Shift 的直接 Y 位移，交給 physics.js
    }

    // ================================================================
    //  視角向量
    // ================================================================

    /** 完整三維前向向量（含仰角） */
    function getForward() {
        var t = _theta * Math.PI / 180;
        var p = _phi   * Math.PI / 180;
        return {
            x:  Math.cos(p) * Math.sin(t),
            y:  Math.sin(p),
            z: -Math.cos(p) * Math.cos(t),
        };
    }

    /** 水平前向向量（移動用） */
    function getForwardH() {
        var t = _theta * Math.PI / 180;
        return { x: Math.sin(t), z: -Math.cos(t) };
    }

    /** 水平右向向量 */
    function getRight() {
        var t = _theta * Math.PI / 180;
        return { x: Math.cos(t), z: Math.sin(t) };
    }

    // ================================================================
    //  Getter
    // ================================================================
    function getPos()   { return _pos; }
    function getDist()  { return _dist; }
    function getTheta() { return _theta; }
    function getPhi()   { return _phi; }

    // ================================================================
    //  內部：事件處理
    // ================================================================

    // ── 防閃現用狀態 ──────────────────────────────────────────────
    var _lockJustAcquired = false;
    var MOVE_CLAMP = 100;

    function _onMouseMove(e) {
        if (document.pointerLockElement !== _canvas) return;

        if (_lockJustAcquired) {
            _lockJustAcquired = false;
            return;
        }

        var dx = e.movementX;
        var dy = e.movementY;
        if (Math.abs(dx) > MOVE_CLAMP || Math.abs(dy) > MOVE_CLAMP) return;

        _theta += dx * MOUSE_SENS;
        _phi   -= dy * MOUSE_SENS;
        _phi    = Math.min(Math.max(_phi, -PHI_LIMIT), PHI_LIMIT);
    }

    function _onLockChange() {
        document.removeEventListener('mousemove', _onMouseMove);
        if (document.pointerLockElement === _canvas) {
            _lockJustAcquired = true;
            document.addEventListener('mousemove', _onMouseMove);
        }
    }

    function _onKeyDown(e) {
        // 任何 UI 持有鍵盤鎖時，完全忽略（終端機、控制台等優先）
        if (typeof InputLock !== 'undefined' && InputLock.isLocked()) return;

        // 讀取目前按鍵綁定（支援設定面板動態修改）
        var KB = window._keyBindings || {};

        _keys[e.code] = true;

        // ── 跳躍 ───────────────────────────────────────────────────
        var jumpKey = KB.jump || 'Space';
        if (e.code === jumpKey) {
            e.preventDefault();
            _jumpQueued = true;
            return;
        }

        // ── 蹲下（按住） ────────────────────────────────────────────
        var crouchKey = KB.crouch || 'ShiftLeft';
        if (e.code === crouchKey || (!KB.crouch && e.code === 'ShiftRight')) {
            _crouching = true;
            return;
        }

        // ── 衝刺 ────────────────────────────────────────────────────
        var sprintKey = KB.sprint || 'CapsLock';
        if (e.code === sprintKey) {
            _sprinting = true;
            return;
        }

        // ── 第三人稱切換（固定 F5，不可改）────────────────────────
        if (e.code === 'F5') {
            e.preventDefault();
            _dist = (_dist === 0) ? THIRD_DIST : 0;
            return;
        }

        // ── 全螢幕（固定 F11，不可改）──────────────────────────────
        if (e.code === 'F11') {
            e.preventDefault();
            document.fullscreenElement
                ? document.exitFullscreen()
                : _gameRoot.requestFullscreen();
            return;
        }
    }

    function _onKeyUp(e) {
        // UI 持有鎖時忽略（避免「鬆開按鍵」訊號漏掉造成卡鍵）
        if (typeof InputLock !== 'undefined' && InputLock.isLocked()) return;

        var KB = window._keyBindings || {};

        _keys[e.code] = false;

        // ── 放開蹲下 ────────────────────────────────────────────────
        var crouchKey = KB.crouch || 'ShiftLeft';
        if (e.code === crouchKey || (!KB.crouch && e.code === 'ShiftRight')) {
            _crouching = false;
        }

        // ── 放開衝刺 ────────────────────────────────────────────────
        var sprintKey = KB.sprint || 'CapsLock';
        if (e.code === sprintKey) {
            _sprinting = false;
        }
    }

    function _clearAll() {
        _keys        = {};
        _crouching   = false;
        _sprinting   = false;
        _jumpQueued  = false;
    }

    function _onResize() {
        if (!_canvas) return;
        _canvas.width  = _canvas.clientWidth  * devicePixelRatio;
        _canvas.height = _canvas.clientHeight * devicePixelRatio;

        if (_projMat)
            _projMat.setPerspective(75, _canvas.width / _canvas.height, 0.05, 500);

        if (typeof gl !== 'undefined' && gl)
            gl.viewport(0, 0, _canvas.width, _canvas.height);
    }

    function _onFullscreen() { _onResize(); }

    // ================================================================
    //  Public API
    // ================================================================
    return {
        init,
        update,
        getForward,
        getForwardH,
        getRight,
        getPos,
        getDist,
        getTheta,
        getPhi,
        isCrouching:    function ()  { return _crouching; },
        isJumpQueued:   function ()  { return _jumpQueued; },
        consumeJump:    function ()  { _jumpQueued = false; },
        onResize: _onResize,
        setSens:   function (v) { MOUSE_SENS    = v; },
        setSpeed:  function (v) { NORMAL_SPEED  = v; },
        setSprint: function (v) { SPRINT_SPEED  = v; },
        setDist:   function (v) { _dist         = v; },
        setPos:    function (x, y, z) { _pos.x = x; _pos.y = y; _pos.z = z; },
        setTheta:  function (v) { _theta = v; },
        setPhi:    function (v) { _phi = Math.min(Math.max(v, -PHI_LIMIT), PHI_LIMIT); },
    };

})();