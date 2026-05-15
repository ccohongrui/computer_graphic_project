// ================================================================
//  physics.js — 重力 / 跳躍 / 蹲下 / 牆壁碰撞
//  依賴: move.js (Move)
//  使用前必須呼叫 Physics.init()，並在每幀呼叫 Physics.update()
// ================================================================
var Physics = (function () {

    // ── 物理常數 ────────────────────────────────────────────────
    var GRAVITY       = -0.008;   // 每幀重力加速度
    var JUMP_VEL      =  0.2;    // 跳躍初速
    var TERMINAL_VEL  = -0.6;     // 最大下落速度
    var GROUND_Y      =  1.7;     // 預設地板高度（站立眼高）
    var STAND_EYE_H   =  1.7;     // 站立時眼睛距地高
    var CROUCH_EYE_H  =  0.9;     // 蹲下時眼睛距地高
    var EYE_LERP      =  0.15;    // 蹲立視角插值速度

    // 玩家膠囊半徑（水平碰撞用）
    var RADIUS        =  0.35;

    // ── 狀態 ────────────────────────────────────────────────────
    var _velY         =  0;       // 垂直速度
    var _onGround     =  false;
    var _feetY        =  0;       // 腳底世界座標（物理真相來源，與眼高無關）

    // 眼高插值（純視覺，不影響物理）
    var _eyeHeightCur = STAND_EYE_H;

    // ── 碰撞幾何（從 OBJ 建立） ──────────────────────────────────
    // _walls : [{ minX, maxX, minZ, maxZ, minY, maxY, nx, nz }]
    //   每個 entry 代表一面「垂直牆」的 AABB 投影
    // _floors : [{ minX, maxX, minZ, maxZ, y }]
    //   代表水平面（地板 / 天花板）
    var _walls  = [];
    var _floors = [];

    // ── 內部工作變數 ─────────────────────────────────────────────
    var _initialized = false;
    var _mapScale    = 1.0;   // 與 Stage.MAP_SCALE 同步，碰撞座標需乘上此值

    // ================================================================
    //  init — 傳入 OBJ 原始頂點群組（Stage._groups 格式）
    //    groups: [{ positions: Float32-like, normals: Float32-like }]
    //  若無法取得 groups，可呼叫 Physics.setGeometry(groups)
    // ================================================================
    function init(groups) {
        _walls  = [];
        _floors = [];

        if (groups && groups.length) {
            _buildCollision(groups);
        } else {
            // 沒有幾何資料時，使用簡單的無限地板
            console.warn('[Physics] 無碰撞幾何，使用預設地板 y=0');
        }

        _initialized = true;
        console.log('[Physics] 初始化完成 | walls:', _walls.length, '| floors:', _floors.length);
    }

    // ================================================================
    //  setGeometry — 可在 Stage 載入完成後再呼叫
    //  scale: Stage 的 MAP_SCALE 倍率，讓碰撞座標與渲染對齊
    // ================================================================
    function setGeometry(groups, scale) {
        _mapScale = (scale && scale > 0) ? scale : 1.0;
        init(groups);
    }

    // ================================================================
    //  建立碰撞幾何
    //  策略：遍歷所有三角形，依法線方向分類成「牆」或「水平面」
    // ================================================================
    function _buildCollision(groups) {
        // 法線 Y > 0.7 → 水平面（地板 / 天花板）
        // 法線 Y 很小 → 垂直面（牆）

        var HORIZ_THRESH = 0.7;
        var MIN_TRI_SIZE = 0.01;   // 忽略過小三角形（避免噪點）

        groups.forEach(function (g) {
            var pos = g.positions;
            var nrm = g.normals;
            var triCount = pos.length / 9;   // 每三角 9 個 float

            for (var i = 0; i < triCount; i++) {
                var base = i * 9;

                var ax = pos[base]     * _mapScale, ay = pos[base + 1] * _mapScale, az = pos[base + 2] * _mapScale;
                var bx = pos[base + 3] * _mapScale, by = pos[base + 4] * _mapScale, bz = pos[base + 5] * _mapScale;
                var cx = pos[base + 6] * _mapScale, cy = pos[base + 7] * _mapScale, cz = pos[base + 8] * _mapScale;

                // 計算平均法線（已正規化）
                var nBase = i * 9;
                var ny = (nrm[nBase + 1] + nrm[nBase + 4] + nrm[nBase + 7]) / 3;
                var nx = (nrm[nBase]     + nrm[nBase + 3] + nrm[nBase + 6]) / 3;
                var nz = (nrm[nBase + 2] + nrm[nBase + 5] + nrm[nBase + 8]) / 3;
                var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (nl < 0.001) continue;
                nx /= nl; ny /= nl; nz /= nl;

                var minX = Math.min(ax, bx, cx);
                var maxX = Math.max(ax, bx, cx);
                var minY = Math.min(ay, by, cy);
                var maxY = Math.max(ay, by, cy);
                var minZ = Math.min(az, bz, cz);
                var maxZ = Math.max(az, bz, cz);

                if (Math.abs(ny) > HORIZ_THRESH) {
                    // 水平面
                    var spanX = maxX - minX;
                    var spanZ = maxZ - minZ;
                    if (spanX < MIN_TRI_SIZE && spanZ < MIN_TRI_SIZE) continue;

                    var avgY = (ay + by + cy) / 3;
                    _floors.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y: avgY, ny: ny });

                } else {
                    // 垂直牆：只需要 XZ 投影範圍 + Y 範圍
                    var spanXZ = Math.max(maxX - minX, maxZ - minZ);
                    if (spanXZ < MIN_TRI_SIZE) continue;

                    // 牆壁厚度需大於零才能碰撞
                    _walls.push({
                        minX: minX - 0.001, maxX: maxX + 0.001,
                        minZ: minZ - 0.001, maxZ: maxZ + 0.001,
                        minY: minY, maxY: maxY,
                        nx: nx, nz: nz,
                    });
                }
            }
        });

        // 合併相近的 floor slab（簡單 bucket，避免每幀遍歷幾萬個三角面）
        _floors = _mergeFloors(_floors);
    }

    // ================================================================
    //  合併相鄰且同高的地板三角形為較大的 AABB（效能優化）
    // ================================================================
    function _mergeFloors(floors) {
        if (floors.length === 0) return floors;

        // 按高度分組（±0.05 視為同層）
        var buckets = {};
        floors.forEach(function (f) {
            var key = Math.round(f.y * 10);   // 0.1 精度
            if (!buckets[key]) buckets[key] = { minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ, y: f.y, ny: f.ny };
            else {
                var b = buckets[key];
                b.minX = Math.min(b.minX, f.minX);
                b.maxX = Math.max(b.maxX, f.maxX);
                b.minZ = Math.min(b.minZ, f.minZ);
                b.maxZ = Math.max(b.maxZ, f.maxZ);
            }
        });

        return Object.keys(buckets).map(function (k) { return buckets[k]; });
    }

    // ================================================================
    //  update — 每幀主邏輯
    //  物理基準：_feetY（腳底），與眼高無關
    //  視覺眼高：_eyeHeightCur 平滑插值，蹲立切換不影響物理
    // ================================================================
    function update() {
        if (!_initialized) return;

        var pos = Move.getPos();
        var x = pos.x, z = pos.z;

        // ── 1. 讀取輸入意圖 ─────────────────────────────────────
        var crouching       = Move.isCrouching();
        var eyeHeightTarget = crouching ? CROUCH_EYE_H : STAND_EYE_H;

        // ── 2. 跳躍（只在落地時觸發）──────────────────────────
        if (Move.isJumpQueued() && _onGround) {
            _velY     = JUMP_VEL;
            _onGround = false;
        }
        Move.consumeJump();

        // ── 3. 重力 ────────────────────────────────────────────
        if (!_onGround) {
            _velY += GRAVITY;
            if (_velY < TERMINAL_VEL) _velY = TERMINAL_VEL;
        }

        // ── 4. 腳底移動 ─────────────────────────────────────────
        var nextFeetY = _feetY + _velY;

        // ── 5. 地板碰撞（基於腳底） ─────────────────────────────
        var floorY = _findFloorY(x, z, nextFeetY);
        if (nextFeetY <= floorY) {
            nextFeetY = floorY;
            _velY     = 0;
            _onGround = true;
        } else {
            _onGround = false;
        }

        // ── 6. 天花板碰撞（頭頂 = 腳底 + 站立高度） ──────────────
        var headY = nextFeetY + STAND_EYE_H;
        var ceilY = _findCeilY(x, z, headY);
        if (headY > ceilY) {
            nextFeetY = ceilY - STAND_EYE_H;
            if (_velY > 0) _velY = 0;
        }

        _feetY = nextFeetY;

        // ── 7. 牆壁碰撞（XZ 平面 slide） ──────────────────────
        var resolved = _resolveWalls(x, _feetY, z);
        x = resolved.x;
        z = resolved.z;

        // ── 8. 視覺眼高平滑插值（蹲立切換不跳視角） ─────────────
        _eyeHeightCur += (eyeHeightTarget - _eyeHeightCur) * EYE_LERP;

        // ── 9. 回寫 Move（眼睛 y = 腳底 + 當前眼高） ──────────
        Move.setPos(x, _feetY + _eyeHeightCur, z);
    }

    // ================================================================
    //  _findFloorY — 找出腳底 (x, z) 位置正下方最高的地板 Y
    // ================================================================
    function _findFloorY(x, z, feetY) {
        var bestFloor = -Infinity;

        if (_floors.length > 0) {
            var r = RADIUS;
            for (var i = 0; i < _floors.length; i++) {
                var f = _floors[i];
                if (x + r >= f.minX && x - r <= f.maxX &&
                    z + r >= f.minZ && z - r <= f.maxZ) {
                    // 地板必須在腳底下方（含 0.5 容差，讓台階可以踩上去）
                    if (f.y <= feetY + 0.5 && f.y > bestFloor) {
                        bestFloor = f.y;
                    }
                }
            }
        }

        return bestFloor === -Infinity ? 0 : bestFloor;
    }

    // ================================================================
    //  _findCeilY — 找出頭頂 (x, z) 位置正上方最低的天花板 Y
    // ================================================================
    function _findCeilY(x, z, headY) {
        var bestCeil = Infinity;
        var r = RADIUS;

        for (var i = 0; i < _floors.length; i++) {
            var f = _floors[i];
            if (f.ny >= 0) continue;   // 只看法線朝下的面（天花板）
            if (x + r >= f.minX && x - r <= f.maxX &&
                z + r >= f.minZ && z - r <= f.maxZ) {
                if (f.y > headY && f.y < bestCeil) {
                    bestCeil = f.y;
                }
            }
        }

        return bestCeil === Infinity ? Infinity : bestCeil - 0.05;
    }

    // ================================================================
    //  _resolveWalls — XZ 平面牆壁碰撞（Slide）
    //  身體高度固定用 STAND_EYE_H，蹲下不縮小碰撞體（避免鑽牆）
    // ================================================================
    function _resolveWalls(x, feetY, z) {
        var r      = RADIUS;
        var bodyH  = STAND_EYE_H;
        var headY  = feetY + bodyH;

        // 最多迭代 3 次解決重疊（角落情況）
        for (var iter = 0; iter < 3; iter++) {
            var pushed = false;

            for (var i = 0; i < _walls.length; i++) {
                var w = _walls[i];

                // 垂直範圍是否重疊（玩家身體）
                if (headY < w.minY || feetY > w.maxY) continue;

                // XZ AABB 膨脹 RADIUS 後是否重疊
                var wx1 = w.minX - r, wx2 = w.maxX + r;
                var wz1 = w.minZ - r, wz2 = w.maxZ + r;

                if (x < wx1 || x > wx2 || z < wz1 || z > wz2) continue;

                // 計算各軸穿透深度，推向穿透最淺的方向
                var overX1 = x - wx1;   // 從左側進入 → 往左推
                var overX2 = wx2 - x;   // 從右側進入 → 往右推
                var overZ1 = z - wz1;
                var overZ2 = wz2 - z;

                var minOver = Math.min(overX1, overX2, overZ1, overZ2);

                if (minOver === overX1) { x -= overX1 + 0.001; pushed = true; }
                else if (minOver === overX2) { x += overX2 + 0.001; pushed = true; }
                else if (minOver === overZ1) { z -= overZ1 + 0.001; pushed = true; }
                else { z += overZ2 + 0.001; pushed = true; }
            }

            if (!pushed) break;
        }

        return { x: x, z: z };
    }

    // ================================================================
    //  Getter
    // ================================================================
    function isOnGround() { return _onGround; }
    function getVelY()    { return _velY; }

    // ================================================================
    //  Public API
    // ================================================================
    return {
        init,
        setGeometry,
        update,
        isOnGround,
        getVelY,
        getWalls:    function () { return _walls; }, 
        setFeetY:    function (v) { _feetY      = v; },
        setGravity:  function (v) { GRAVITY     = v; },
        setJumpVel:  function (v) { JUMP_VEL    = v; },
        setRadius:   function (v) { RADIUS      = v; },
    };

})();