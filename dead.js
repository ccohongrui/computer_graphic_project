// ================================================================
//  dead.js — 死亡演出（改良版，無血跡）
//
//  流程：
//    Phase 0  (0.0 ~ 0.6s) : 視角平滑轉向怪物 + 仰頭 + 衝擊閃光 + 暗角收縮
//    Phase 1  (0.6 ~ 1.8s) : 劇烈晃動 + 靜態噪點 + 掃描線 + 字幕
//    Phase 2  (1.8 ~ 2.8s) : 晃動衰減 + 全黑淡出
//    Phase 3  (2.8s+)      : 重置，回到遊戲
//
//  全域調整變數（在 main.js 頂部設定）：
//    DEAD_EYE_Y           — 仰角偏移（度，正=更仰）  預設 0
//    DEAD_SHAKE_INTENSITY — 晃動幅度倍率              預設 1.0
//    DEAD_SHAKE_FREQ      — 晃動頻率倍率              預設 1.0
// ================================================================

var Dead = (function () {

    var _active    = false;
    var _startTime = 0;
    var _npc       = null;

    var _fromTheta = 0;
    var _fromPhi   = 0;
    var _toTheta   = 0;
    var _toPhi     = 0;

    // Canvas overlay
    var _canvas = null;
    var _ctx    = null;

    // 靜態噪點 offscreen canvas（避免每幀重建）
    var _noiseCanvas = null;
    var _noiseCtx    = null;
    var _noiseFrame  = -1;

    var PHASE = [0, 0.6, 1.8, 2.8];

    // ── overlay canvas ────────────────────────────────────────────
    function _createCanvas() {
        if (_canvas) return;
        _canvas = document.createElement('canvas');
        _canvas.style.cssText = [
            'position:fixed','top:0','left:0',
            'width:100%','height:100%',
            'pointer-events:none',
            'z-index:9999',
        ].join(';');
        document.body.appendChild(_canvas);
        _ctx = _canvas.getContext('2d');
        _resizeCanvas();

        // 建立噪點 offscreen canvas
        _noiseCanvas = document.createElement('canvas');
        _noiseCanvas.width  = 256;
        _noiseCanvas.height = 256;
        _noiseCtx = _noiseCanvas.getContext('2d');
    }

    function _resizeCanvas() {
        if (!_canvas) return;
        _canvas.width  = window.innerWidth;
        _canvas.height = window.innerHeight;
    }

    function _removeCanvas() {
        if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
        _canvas = null;
        _ctx    = null;
        _noiseCanvas = null;
        _noiseCtx    = null;
        _noiseFrame  = -1;
    }

    // ── helpers ───────────────────────────────────────────────────
    function _angleDiff(from, to) {
        return ((to - from) % 360 + 540) % 360 - 180;
    }
    function _easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
    function _easeIn(t)    { return t * t * t; }

    function _getGlobal(name, def) {
        return (typeof window[name] !== 'undefined') ? window[name] : def;
    }

    // ── 快速偽隨機（不依賴 seed 的版本，純用 sin） ───────────────
    function _rng(x, y, s) {
        return ((Math.sin(x * 127.1 + y * 311.7 + s * 74.3) * 43758.5) % 1 + 1) % 1;
    }

    // ── 靜態噪點（每 N 幀更新一次，畫到 offscreen canvas） ───────
    function _updateNoise(frameNum) {
        if (!_noiseCtx) return;
        if (frameNum === _noiseFrame) return;
        _noiseFrame = frameNum;

        var W = _noiseCanvas.width, H = _noiseCanvas.height;
        var img = _noiseCtx.createImageData(W, H);
        var d   = img.data;
        for (var i = 0; i < d.length; i += 4) {
            var px  = (i / 4) % W;
            var py  = Math.floor((i / 4) / W);
            var v   = _rng(px, py, frameNum) * 255 | 0;
            d[i]   = v;
            d[i+1] = v;
            d[i+2] = v;
            d[i+3] = v * 0.6 | 0;   // 半透明噪點
        }
        _noiseCtx.putImageData(img, 0, 0);
    }

    // ── 計算目標視角 ──────────────────────────────────────────────
    function _calcTargetAngles(playerPos, npc) {
        var npcPos = npc.getPos();
        var dx = npcPos.x - playerPos.x;
        var dz = npcPos.z - playerPos.z;

        var targetTheta = Math.atan2(dx, -dz) * 180 / Math.PI;

        var npcEyeY    = npc.cfg.eyeY !== undefined ? npc.cfg.eyeY : npcPos.y;
        var playerEyeY = playerPos.y + 1.6;
        var dy         = npcEyeY - playerEyeY;
        var horiz      = Math.sqrt(dx * dx + dz * dz);
        var targetPhi  = Math.atan2(dy, horiz) * 180 / Math.PI;

        var extra = _getGlobal('DEAD_EYE_Y', 0);
        targetPhi = Math.max(-89, Math.min(89, targetPhi + extra));

        return { theta: targetTheta, phi: targetPhi };
    }

    // ── 晃動偏移 ─────────────────────────────────────────────────
    function _shakeOffset(t) {
        var elapsed  = t - PHASE[1];
        var duration = PHASE[2] - PHASE[1];
        var decay    = 1 - Math.min(elapsed / duration, 1);

        var intensity = _getGlobal('DEAD_SHAKE_INTENSITY', 1.0);
        var freq      = _getGlobal('DEAD_SHAKE_FREQ',      1.0);

        var dTheta = (
            Math.sin(t * 29.0 * freq)        * 7.0 +
            Math.sin(t * 17.3 * freq + 0.7)  * 3.5 +
            Math.sin(t * 43.1 * freq + 1.3)  * 1.5
        ) * decay * intensity;

        var dPhi = (
            Math.cos(t * 23.0 * freq + 0.5)  * 5.0 +
            Math.cos(t * 13.7 * freq + 1.0)  * 2.5 +
            Math.cos(t * 37.3 * freq + 2.1)  * 1.0
        ) * decay * intensity;

        return { dTheta: dTheta, dPhi: dPhi };
    }

    // ── 畫面繪製 ──────────────────────────────────────────────────
    function _draw(t) {
        if (!_ctx) return;
        _resizeCanvas();
        var W = _canvas.width, H = _canvas.height;
        _ctx.clearRect(0, 0, W, H);

        // ─────────────────────────────────────────────────────────
        // Phase 0：衝擊閃光 + 四角暗角快速收縮
        // ─────────────────────────────────────────────────────────
        if (t < PHASE[1]) {
            var p0 = t / PHASE[1];   // 0 → 1

            // 1. 紅色衝擊光（sine bell curve，峰值在中段）
            var flashAlpha = Math.sin(p0 * Math.PI) * 0.8;
            _ctx.fillStyle = 'rgba(180,0,0,' + flashAlpha + ')';
            _ctx.fillRect(0, 0, W, H);

            // 2. 白色過曝閃（前 0.15s 快速閃一下）
            var whiteAlpha = Math.max(0, (0.15 - t) / 0.15) * 0.5;
            if (whiteAlpha > 0) {
                _ctx.fillStyle = 'rgba(255,220,220,' + whiteAlpha + ')';
                _ctx.fillRect(0, 0, W, H);
            }

            // 3. 四角暗角（越來越深）
            var vigAmt = _easeInOut(p0);
            var gv = _ctx.createRadialGradient(W/2, H/2, H * (0.55 - vigAmt * 0.35),
                                               W/2, H/2, H * 0.9);
            gv.addColorStop(0, 'rgba(0,0,0,0)');
            gv.addColorStop(1, 'rgba(0,0,0,' + (vigAmt * 0.85) + ')');
            _ctx.fillStyle = gv;
            _ctx.fillRect(0, 0, W, H);

            // 4. 細細的紅色邊框（從透明漸入）
            _ctx.strokeStyle = 'rgba(200,0,0,' + (p0 * 0.6) + ')';
            _ctx.lineWidth   = 12;
            _ctx.strokeRect(0, 0, W, H);

            return;
        }

        // ─────────────────────────────────────────────────────────
        // Phase 1：靜態噪點 + 掃描線 + 暗角 + 字幕
        // ─────────────────────────────────────────────────────────
        if (t < PHASE[2]) {
            var p1      = (t - PHASE[1]) / (PHASE[2] - PHASE[1]);   // 0 → 1
            var frameNo = Math.floor(t * 24) | 0;  // 24fps 噪點更新

            // 1. 固定暗角
            var gv1 = _ctx.createRadialGradient(W/2, H/2, H * 0.12,
                                                W/2, H/2, H * 0.72);
            gv1.addColorStop(0, 'rgba(0,0,0,0)');
            gv1.addColorStop(1, 'rgba(0,0,0,0.90)');
            _ctx.fillStyle = gv1;
            _ctx.fillRect(0, 0, W, H);

            // 2. 靜態噪點（tile 繪製到全畫面）
            _updateNoise(frameNo);
            if (_noiseCanvas) {
                var noiseAlpha = 0.18 + Math.sin(t * 8) * 0.06;
                _ctx.globalAlpha = noiseAlpha;
                var nW = _noiseCanvas.width, nH = _noiseCanvas.height;
                for (var nx = 0; nx < W; nx += nW) {
                    for (var ny = 0; ny < H; ny += nH) {
                        _ctx.drawImage(_noiseCanvas, nx, ny);
                    }
                }
                _ctx.globalAlpha = 1.0;
            }

            // 3. 水平掃描線
            _ctx.save();
            _ctx.globalAlpha = 0.12;
            _ctx.fillStyle   = '#000';
            for (var ly = 0; ly < H; ly += 4) {
                _ctx.fillRect(0, ly, W, 2);
            }
            _ctx.restore();

            // 4. 移動中的亮掃描帶（模擬 CRT 掃描）
            var scanY = (t * H * 0.4) % (H + 80) - 40;
            var gscan = _ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
            gscan.addColorStop(0,   'rgba(255,200,200,0)');
            gscan.addColorStop(0.5, 'rgba(255,200,200,0.07)');
            gscan.addColorStop(1,   'rgba(255,200,200,0)');
            _ctx.fillStyle = gscan;
            _ctx.fillRect(0, scanY - 30, W, 60);

            // 5. 紅色邊框脈動
            var pulse = 0.4 + Math.abs(Math.sin(t * 14)) * 0.5;
            _ctx.strokeStyle = 'rgba(210,0,0,' + pulse + ')';
            _ctx.lineWidth   = 18;
            _ctx.strokeRect(0, 0, W, H);

            // 6. 角落紅色漸層（取代血跡，製造壓迫感）
            var cornerAlpha = 0.3 + Math.sin(t * 9) * 0.15;
            [
                [0, 0],
                [W, 0],
                [0, H],
                [W, H]
            ].forEach(function(corner) {
                var gc = _ctx.createRadialGradient(
                    corner[0], corner[1], 0,
                    corner[0], corner[1], H * 0.45
                );
                gc.addColorStop(0, 'rgba(150,0,0,' + cornerAlpha + ')');
                gc.addColorStop(1, 'rgba(0,0,0,0)');
                _ctx.fillStyle = gc;
                _ctx.fillRect(0, 0, W, H);
            });

            // 7. 字幕（呼吸閃動）
            var fadeIn   = Math.min((t - PHASE[1]) / 0.2, 1);
            var breathe  = 0.7 + Math.sin(t * 10) * 0.3;
            var fontSize = Math.floor(H * 0.052);

            _ctx.save();
            _ctx.globalAlpha  = fadeIn * breathe;
            _ctx.font         = 'bold ' + fontSize + 'px monospace';
            _ctx.textAlign    = 'center';
            _ctx.textBaseline = 'middle';

            // 字幕陰影層（偏移，製造 glitch 感）
            _ctx.fillStyle  = 'rgba(255,0,0,0.4)';
            _ctx.shadowBlur = 0;
            _ctx.fillText('DANGEROUS', W/2 + 2, H * 0.14 + 1);

            // 字幕主體
            _ctx.fillStyle   = '#ff2222';
            _ctx.shadowColor = '#000';
            _ctx.shadowBlur  = 18;
            _ctx.fillText('DANGEROUS', W/2, H * 0.14);
            _ctx.restore();

            return;
        }

        // ─────────────────────────────────────────────────────────
        // Phase 2：漸黑淡出
        // ─────────────────────────────────────────────────────────
        if (t < PHASE[3]) {
            var p2   = (t - PHASE[2]) / (PHASE[3] - PHASE[2]);
            var dark = _easeIn(p2);

            // 殘留暗角
            var gv2 = _ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, H*0.7);
            gv2.addColorStop(0, 'rgba(0,0,0,0)');
            gv2.addColorStop(1, 'rgba(0,0,0,0.88)');
            _ctx.fillStyle = gv2;
            _ctx.fillRect(0, 0, W, H);

            // 全黑蓋上
            _ctx.fillStyle = 'rgba(0,0,0,' + dark + ')';
            _ctx.fillRect(0, 0, W, H);
        }
    }

    // ── 每幀 update ───────────────────────────────────────────────
    function update() {
        if (!_active) return;

        var t = performance.now() / 1000 - _startTime;

        if (t < PHASE[1]) {
            var p = _easeInOut(Math.min(t / PHASE[1], 1));
            Move.setTheta(_fromTheta + _angleDiff(_fromTheta, _toTheta) * p);
            Move.setPhi  (_fromPhi   + (_toPhi - _fromPhi) * p);
        }
        else if (t < PHASE[3]) {
            var s = _shakeOffset(t);
            Move.setTheta(_toTheta + s.dTheta);
            Move.setPhi  (Math.max(-89, Math.min(89, _toPhi + s.dPhi)));
        }
        else {
            _finish();
            return;
        }

        _draw(t);
    }

    // ── 重置 ──────────────────────────────────────────────────────
    function _finish() {
        _active = false;
        _removeCanvas();

        Move.setTheta(0);
        Move.setPhi(0);

        if (Move.setPos) {
            Move.setPos(_spawnPos.x, _spawnPos.y, _spawnPos.z);
        }

        if (typeof _npcs !== 'undefined') {
            _npcs.length = 0;
            if (typeof spawnNPCs === 'function') spawnNPCs(gl);

            // ★ 重生後重新同步 Flashlight 的 smiler 清單
            //   舊的 NPC 參照已失效，必須用新物件重新註冊
            if (typeof Flashlight !== 'undefined') {
                Flashlight.clearSmilers();
                for (var i = 0; i < _npcs.length; i++) {
                    if (_npcs[i].cfg.type === 'smiler') {
                        Flashlight.registerSmiler(_npcs[i]);
                    }
                }
            }
        }

        _isDead   = false;
        _npc      = null;
        _lastTime = performance.now();

        // ★ 音效：重生後依日夜狀態恢復背景音效
        if (typeof AudioManager !== 'undefined') AudioManager.onRespawn();

        // ★ 重生時重置 Victor 狀態（清除殘留並恢復 UI 容器顯示）
        //   注意：這裡用 reset() 而非 forceClose()，
        //   forceClose 會把 _ui.style.display 設為 none 導致終端機/紙張永久消失
        if (typeof Victor !== 'undefined' && Victor.reset) Victor.reset();

        console.log('[Dead] 重置完成');
    }

    // ── trigger ───────────────────────────────────────────────────
    function trigger(npc) {
        if (_active) return;
        _active    = true;
        _npc       = npc;
        _startTime = performance.now() / 1000;

        // ★ 音效：死亡 → kill.mp3，停止所有背景音效
        if (typeof AudioManager !== 'undefined') AudioManager.onDead();

        // ★ 死亡當下：強制關閉所有 Victor UI（終端機、紙張預覽）
        if (typeof Victor !== 'undefined' && Victor.forceClose) Victor.forceClose();

        _fromTheta = Move.getTheta();
        _fromPhi   = Move.getPhi();

        var playerPos = Move.getPos();
        var angles    = _calcTargetAngles(playerPos, npc);
        _toTheta = angles.theta;
        _toPhi   = angles.phi;

        _createCanvas();

        console.log('[Dead] 觸發',
            '| 兇手:', npc ? npc.cfg.type : '?',
            '| eyeY:', npc ? npc.cfg.eyeY : '?',
            '| phi目標:', _toPhi.toFixed(1) + '°'
        );
    }

    return {
        trigger : trigger,
        update  : update,
        isActive: function () { return _active; },
    };

})();