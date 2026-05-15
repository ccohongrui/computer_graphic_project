// ================================================================
//  ★★★  全域調整區（改這裡就夠了）  ★★★
// ================================================================

// ── 終端機位置 ──────────────────────────────────────────────────
var VICTOR_TERMINAL_POS_X  = 16.0;
var VICTOR_TERMINAL_POS_Y  =  2.2;
var VICTOR_TERMINAL_POS_Z  = 41.2;

// ── 終端機互動框大小（世界單位） ────────────────────────────────
var VICTOR_TERMINAL_W      =  2.8;   // 寬度
var VICTOR_TERMINAL_H      =  4.5;   // 高度

// ── 終端機互動距離（玩家需在此距離內才能點擊） ──────────────────
var VICTOR_TERMINAL_DIST   =  3.0;

// ── 紙張撿起距離 ────────────────────────────────────────────────
var VICTOR_PICK_DIST       =  3.0;

// ── 紙張互動框大小（世界單位，預設自動讀取 paper.js 的值） ───────
//    若 paper.js 有定義 PAPER_WIDTH / PAPER_HEIGHT 則優先使用那邊的值
//    若想在這裡覆蓋，把下方兩行改成你要的數字（去掉 null）
var VICTOR_PAPER_W         = null;   // null = 自動跟 paper.js；或填如 0.6
var VICTOR_PAPER_H         = null;   // null = 自動跟 paper.js；或填如 0.8

// ================================================================

// ================================================================
//  victor.js — 終端機謎題 + 逃脫系統
//  依賴: paper.js (Paper), move.js (Move)
//  左鍵點擊靠近紙張 → 撿起查看
//  左鍵點擊終端機   → 開啟輸入介面
//  密碼正確         → 逃脫動畫
// ================================================================

var Victor = (function () {

    // ── 設定 ─────────────────────────────────────────────────────
    // ── 以下數值由頂部全域變數控制，不要在這裡改 ──────────────

    // ── 內部狀態 ─────────────────────────────────────────────────
    var _collected     = [];    // 已收集的紙張資料 {type, content, color}
    var _terminalOpen  = false; // 終端機 UI 是否開啟
    var _escaped       = false; // 是否已逃脫
    var _password      = '';    // 正確密碼（由 paper 顏色配對產生）
    var _inputBuffer   = '';    // 玩家輸入中的字串

    // 終端機世界座標（請依你的地圖修改）
    // TERMINAL_POS / VICTOR_PICK_DIST / VICTOR_TERMINAL_DIST 已移至頂部全域變數

    // ── DOM refs ─────────────────────────────────────────────────
    var _ui            = null;   // 整個 Victor UI 容器
    var _terminalEl    = null;   // 終端機輸入面板
    var _paperViewEl   = null;   // 紙張放大預覽
    var _notifyEl      = null;   // 右下角提示
    var _memoryEl      = null;   // 左上角記憶顯示 HUD
    var _hintCanvas    = null;   // 3D 框投影 overlay canvas
    var _projMat       = null;   // 每幀由 update() 傳入
    var _viewMat       = null;

    // ================================================================
    //  init — 在 main() 裡呼叫
    // ================================================================
    function init() {
        _buildUI();
        _bindEvents();
        console.log('[Victor] 初始化完成');
    }

    // ================================================================
    //  _buildUI — 建立所有 HTML 覆蓋層（只建立一次）
    // ================================================================
    function _buildUI() {
        // 若 UI 已存在則跳過，避免重複建立
        if (document.getElementById('victor-ui')) {
            _ui         = document.getElementById('victor-ui');
            _notifyEl   = document.getElementById('victor-notify');
            _paperViewEl= document.getElementById('victor-paper-view');
            _terminalEl = document.getElementById('victor-terminal');
            _memoryEl   = document.getElementById('victor-memory');
            _hintCanvas = document.querySelector('canvas[style*="z-index:201"]');
            console.log('[Victor] UI 已存在，重新綁定參照');
            return;
        }
        // 主容器
        _ui = document.createElement('div');
        _ui.id = 'victor-ui';
        _ui.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:200;font-family:"Courier New",monospace;';
        document.body.appendChild(_ui);

        // ── 右下角提示（靠近物體時顯示）
        _notifyEl = document.createElement('div');
        _notifyEl.id = 'victor-notify';
        _notifyEl.style.cssText = [
            'position:absolute;bottom:80px;right:40px',
            'color:#d4c89a;font-size:14px;letter-spacing:2px',
            'text-shadow:0 0 8px rgba(212,200,154,0.8)',
            'opacity:0;transition:opacity 0.3s',
            'pointer-events:none;text-align:right',
        ].join(';');
        _ui.appendChild(_notifyEl);

        // ── 左上角記憶 HUD（已查看紙張顯示）
        _memoryEl = document.createElement('div');
        _memoryEl.id = 'victor-memory';
        _memoryEl.style.cssText = [
            'position:absolute;top:22px;left:24px',
            'color:#c8b87a;font-size:11px;letter-spacing:2.5px',
            'font-family:"Courier New",monospace',
            'pointer-events:none',
            'opacity:0;transition:opacity 0.4s',
            'line-height:1.0',
        ].join(';');
        _ui.appendChild(_memoryEl);

        // ── 紙張預覽覆蓋層
        _paperViewEl = document.createElement('div');
        _paperViewEl.id = 'victor-paper-view';
        _paperViewEl.style.cssText = [
            'position:absolute;top:0;left:0;width:100%;height:100%',
            'display:flex;align-items:center;justify-content:center',
            'background:rgba(0,0,0,0.85);opacity:0',
            'transition:opacity 0.35s;pointer-events:none',
        ].join(';');
        _paperViewEl.innerHTML = '<div id="victor-paper-card" style="' + [
            'width:260px;height:340px;background:#f5f0e0',
            'border-radius:4px;display:flex;flex-direction:column',
            'align-items:center;justify-content:center',
            'box-shadow:0 0 60px rgba(0,0,0,0.9)',
            'position:relative;overflow:hidden',
        ].join(';') + '"></div>';
        _ui.appendChild(_paperViewEl);

        // ── 終端機輸入面板
        _terminalEl = document.createElement('div');
        _terminalEl.id = 'victor-terminal';
        _terminalEl.style.cssText = [
            'position:absolute;top:50%;left:50%',
            'transform:translate(-50%,-50%)',
            'width:520px;background:#0a0a0a',
            'border:1px solid #3a3a2a;border-radius:4px',
            'padding:28px 32px;box-shadow:0 0 80px rgba(0,0,0,0.95)',
            'opacity:0;pointer-events:none;transition:opacity 0.3s',
        ].join(';');
        _terminalEl.innerHTML =
            '<div style="color:#888;font-size:11px;letter-spacing:3px;margin-bottom:20px">BACKROOMS TERMINAL v0.1</div>' +
            '<div id="vt-log" style="color:#a09060;font-size:13px;line-height:1.9;min-height:120px;max-height:200px;overflow:hidden"></div>' +
            '<div style="display:flex;align-items:center;margin-top:18px;border-top:1px solid #2a2a1a;padding-top:14px">' +
            '  <span style="color:#d4c89a;font-size:14px;margin-right:8px">&gt;</span>' +
            '  <span id="vt-input" style="color:#d4c89a;font-size:14px;letter-spacing:2px;min-width:1ch"></span>' +
            '  <span id="vt-cursor" style="display:inline-block;width:9px;height:16px;background:#d4c89a;margin-left:2px;animation:vtblink 1s step-end infinite"></span>' +
            '</div>';
        // 閃爍動畫
        var style = document.createElement('style');
        style.textContent = '@keyframes vtblink{0%,100%{opacity:1}50%{opacity:0}}';
        document.head.appendChild(style);
        _ui.appendChild(_terminalEl);

        // ── 3D 框投影 canvas（pointer-events:none，純提示用）
        _hintCanvas = document.createElement('canvas');
        _hintCanvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:201;';
        document.body.appendChild(_hintCanvas);
        _resizeHintCanvas();
        window.addEventListener('resize', _resizeHintCanvas);
    }

    function _resizeHintCanvas() {
        if (!_hintCanvas) return;
        _hintCanvas.width  = window.innerWidth;
        _hintCanvas.height = window.innerHeight;
    }

    // ================================================================
    //  _bindEvents — 左鍵點擊 + 鍵盤輸入（只綁一次）
    // ================================================================
    var _eventsBound = false;
    function _bindEvents() {
        if (_eventsBound) return;
        _eventsBound = true;
        // 左鍵點擊
        document.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            if (_escaped) return;

            if (_terminalOpen) {
                // 點擊任意處關閉（點終端機外面關閉）
                if (!_terminalEl.contains(e.target)) {
                    _closeTerminal();
                }
                return;
            }

            if (_paperViewEl.style.opacity === '1') {
                _closePaperView();
                return;
            }

            // 嘗試與最近的紙張或終端機互動
            _tryInteract();
        });

        // 鍵盤：終端機輸入
        document.addEventListener('keydown', function (e) {
            if (_escaped) return;

            // 紙張預覽中，Esc 也可以關閉
            if (_paperViewEl && _paperViewEl.style.opacity === '1') {
                if (e.key === 'Escape') { e.stopPropagation(); _closePaperView(); return; }
                e.stopPropagation(); // 預覽中吃掉所有按鍵
                return;
            }

            if (!_terminalOpen) return;

            // 終端機開啟時，吃掉所有按鍵（不讓遊戲邏輯收到）
            e.stopPropagation();

            if (e.key === 'Escape') {
                _closeTerminal(); return;
            }
            if (e.key === 'Enter') {
                _submitPassword(); return;
            }
            if (e.key === 'Backspace') {
                _inputBuffer = _inputBuffer.slice(0, -1);
                _updateInputDisplay(); return;
            }
            if (e.key.length === 1 && _inputBuffer.length < 5) {
                _inputBuffer += e.key.toUpperCase();
                _updateInputDisplay();
            }
        }, true);
    }

    // ================================================================
    //  _tryInteract — 判斷玩家面前是否有可互動物件
    // ================================================================
    function _tryInteract() {
        if (typeof Move === 'undefined') return;

        var _pos = Move.getPos();
        var px = _pos.x, py = _pos.y, pz = _pos.z;

        // 先檢查終端機
        var td = _dist3(px, py, pz, VICTOR_TERMINAL_POS_X, VICTOR_TERMINAL_POS_Y, VICTOR_TERMINAL_POS_Z);
        if (td < VICTOR_TERMINAL_DIST && !_hasWallBetween(px, py, pz, VICTOR_TERMINAL_POS_X, py, VICTOR_TERMINAL_POS_Z)) {
            _openTerminal(); return;
        }

        // 再檢查紙張
        if (typeof Paper === 'undefined') return;
        var papers = Paper.getPapers();
        var best = null, bestDist = VICTOR_PICK_DIST;

        for (var i = 0; i < papers.length; i++) {
            var p = papers[i];
            if (p.collected) continue;
            var d = _dist3(px, py, pz, p.x, p.y, p.z);
            if (d < bestDist && !_hasWallBetween(px, py, pz, p.x, py, p.z)) {
                bestDist = d; best = p;
            }
        }

        if (best) {
            best.collected = true;
            _collected.push({ type: best.type, content: best.content, color: best.color });
            _showPaperView(best);
            _updatePassword();
            _updateMemoryHUD();
            _log('[ 拾起 ' + (best.type === 'letter' ? '字母紙' : '數字紙') + '：' + best.content + ' ]');
        }
    }

    // ================================================================
    //  _updatePassword — 根據已收集資料重算密碼
    //  規則：找出每張字母紙的顏色 → 查同色數字紙的 content → 組成密碼
    // ================================================================
    function _updatePassword() {
        if (typeof Paper === 'undefined') return;
        var all     = Paper.getPapers();
        var letters = all.filter(function (p) { return p.type === 'letter'; });
        var numbers = all.filter(function (p) { return p.type === 'number'; });

        // 顏色 → 字母
        var colorToLetter = {};
        letters.forEach(function (p) { colorToLetter[p.color] = p.content; });

        // 數字(1~5) → 顏色 → 字母，依序排出密碼
        var order = {};
        numbers.forEach(function (p) { order[p.content] = p.color; });

        var pwd = '';
        for (var i = 1; i <= 5; i++) {
            var letter = colorToLetter[order[String(i)]];
            if (letter) pwd += letter;
        }
        _password = pwd;
    }

    // ================================================================
    //  _showPaperView — 放大顯示剛撿到的紙張
    // ================================================================
    function _showPaperView(paper) {
        // 鎖定指標釋放（讓滑鼠可見）
        if (document.pointerLockElement) document.exitPointerLock();

        var card = document.getElementById('victor-paper-card');

        // 紙張線條背景
        card.style.background = '#f5f0e0';
        card.innerHTML = '';

        // 用 canvas 繪製和 paper.js 一樣的外觀
        var cv = document.createElement('canvas');
        cv.width = 260; cv.height = 340;
        var ctx = cv.getContext('2d');

        // 底色
        ctx.fillStyle = '#f5f0e0';
        ctx.fillRect(0, 0, 260, 340);

        // 橫線
        ctx.strokeStyle = 'rgba(180,170,140,0.4)';
        ctx.lineWidth = 1;
        for (var ly = 40; ly < 340; ly += 28) {
            ctx.beginPath(); ctx.moveTo(20, ly); ctx.lineTo(240, ly); ctx.stroke();
        }

        // 裝訂線
        ctx.strokeStyle = 'rgba(200,80,80,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(48, 0); ctx.lineTo(48, 340); ctx.stroke();

        // 文字顏色
        var colorMap = {
            red:    '#f01414', yellow: '#ebe80d', blue: '#1a4dff',
            green:  '#1acc33', white:  '#ffffff', black: '#111111'
        };
        var fc = colorMap[paper.color] || '#333';

        ctx.fillStyle = fc;
        ctx.font = 'bold 200px "Arial Black",Arial,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor   = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur    = 8;
        ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 3;
        ctx.fillText(paper.content, 130, 170);

        // 左上角類型標籤
        ctx.font = 'bold 16px "Courier New",monospace';
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(paper.type === 'letter' ? 'LETTER' : 'NUMBER', 56, 12);

        card.appendChild(cv);

        // 提示文字
        var hint = document.createElement('div');
        hint.style.cssText = 'position:absolute;bottom:12px;width:100%;text-align:center;font-size:11px;color:#999;letter-spacing:2px;font-family:"Courier New",monospace';
        hint.textContent = 'CLICK TO CLOSE';
        card.appendChild(hint);

        _paperViewEl.style.pointerEvents = 'all';
        _paperViewEl.style.opacity = '1';
        if (typeof InputLock !== 'undefined') InputLock.claim('victor-paper');
    }

    function _closePaperView() {
        if (typeof InputLock !== 'undefined') InputLock.release('victor-paper');
        _paperViewEl.style.opacity = '0';
        _paperViewEl.style.pointerEvents = 'none';
        // 重新鎖定指標
        var canvas = document.getElementById('glCanvas');
        if (canvas && window.gameActive) setTimeout(function () { canvas.requestPointerLock(); }, 100);
    }

    // ================================================================
    //  _openTerminal / _closeTerminal
    // ================================================================
    function _openTerminal() {
        if (document.pointerLockElement) document.exitPointerLock();
        if (typeof InputLock !== 'undefined') InputLock.claim('victor-terminal');
        _terminalOpen = true;
        _inputBuffer  = '';
        _updateInputDisplay();

        var log = document.getElementById('vt-log');
        log.innerHTML = '';
        _vtLog('BACKROOMS ESCAPE SYSTEM');
        _vtLog('');
        _vtLog('找到所有紙張，以顏色配對推算密碼。');
        _vtLog('輸入 5 位數密碼以解鎖出口：');
        _vtLog('');
        _vtLog('已收集：' + _collected.length + ' / 10 張');

        _terminalEl.style.opacity = '1';
        _terminalEl.style.pointerEvents = 'all';
    }

    function _closeTerminal() {
        _terminalOpen = false;
        if (typeof InputLock !== 'undefined') InputLock.release('victor-terminal');
        _terminalEl.style.opacity = '0';
        _terminalEl.style.pointerEvents = 'none';
        var canvas = document.getElementById('glCanvas');
        if (canvas && window.gameActive) setTimeout(function () { canvas.requestPointerLock(); }, 100);
    }

    function _vtLog(msg) {
        var log = document.getElementById('vt-log');
        if (!log) return;
        var line = document.createElement('div');
        line.textContent = msg;
        log.appendChild(line);
    }

    function _updateInputDisplay() {
        var el = document.getElementById('vt-input');
        if (el) el.textContent = _inputBuffer;
    }

    // ================================================================
    //  _submitPassword
    // ================================================================
    function _submitPassword() {
        _updatePassword(); // 確保最新

        var log = document.getElementById('vt-log');
        _vtLog('');
        _vtLog('> ' + _inputBuffer);

        if (_inputBuffer === _password) {
            _vtLog('');
            _vtLog('✓ 密碼正確。出口解鎖中...');
            setTimeout(function () {
                _closeTerminal();
                _triggerEscapeAnimation();
            }, 900);
        } else {
            _vtLog('✗ 密碼錯誤。');
            _inputBuffer = '';
            _updateInputDisplay();
            // 紅色閃爍
            _terminalEl.style.borderColor = '#a00';
            setTimeout(function () { _terminalEl.style.borderColor = '#3a3a2a'; }, 400);
        }
    }

    // ================================================================
    //  逃脫動畫
    //  Phase 1 (0–1.5s)  : 畫面電視靜電閃爍
    //  Phase 2 (1.5–3s)  : 白光爆閃 + 場景扭曲
    //  Phase 3 (3–5s)    : 黑幕淡入，"YOU ESCAPED" 文字浮現
    //  Phase 4 (5–8s)    : 結束畫面停留
    // ================================================================
    function _triggerEscapeAnimation() {
        _escaped = true;
        if (document.pointerLockElement) document.exitPointerLock();

        // ★ 音效：勝利結算 → noise.mp3（不循環），停止所有背景音效
        if (typeof AudioManager !== 'undefined') AudioManager.onWin();

        var overlay = document.createElement('div');
        overlay.id = 'victor-escape-overlay';
        overlay.style.cssText = [
            'position:fixed;top:0;left:0;width:100%;height:100%',
            'z-index:9999;pointer-events:all',
            'background:transparent',
        ].join(';');
        document.body.appendChild(overlay);

        // ── Phase 1: 靜電 canvas ─────────────────────────────────
        var staticCanvas = document.createElement('canvas');
        staticCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;opacity:0.85';
        staticCanvas.width  = window.innerWidth;
        staticCanvas.height = window.innerHeight;
        overlay.appendChild(staticCanvas);
        var sc = staticCanvas.getContext('2d');

        var staticRunning = true;
        var staticStart   = performance.now();

        function drawStatic(now) {
            if (!staticRunning) return;
            var elapsed = now - staticStart;
            var alpha   = Math.min(elapsed / 400, 1);            // 淡入
            var fade    = elapsed > 1000 ? 1 - (elapsed - 1000) / 500 : 1; // 淡出
            staticCanvas.style.opacity = (alpha * fade * 0.9).toFixed(3);

            var imgd = sc.createImageData(staticCanvas.width, staticCanvas.height);
            var d = imgd.data;
            for (var i = 0; i < d.length; i += 4) {
                var v = Math.random() > 0.5 ? 255 : 0;
                // 掃描線效果：每隔一行變暗
                var row = Math.floor((i / 4) / staticCanvas.width);
                var scanline = (row % 3 === 0) ? 0.3 : 1;
                d[i]   = v * scanline;
                d[i+1] = v * scanline;
                d[i+2] = v * scanline;
                d[i+3] = 200;
            }
            sc.putImageData(imgd, 0, 0);

            if (elapsed < 1500) requestAnimationFrame(drawStatic);
            else { staticRunning = false; staticCanvas.style.opacity = '0'; }
        }
        requestAnimationFrame(drawStatic);

        // ── Phase 2: 白光爆閃 (1.2s 時觸發) ─────────────────────
        setTimeout(function () {
            var flash = document.createElement('div');
            flash.style.cssText = [
                'position:absolute;top:0;left:0;width:100%;height:100%',
                'background:white;opacity:0',
                'transition:opacity 0.15s ease-in',
            ].join(';');
            overlay.appendChild(flash);

            // 爆閃序列
            setTimeout(function () { flash.style.opacity = '0.7'; }, 50);
            setTimeout(function () { flash.style.opacity = '0.1'; }, 200);
            setTimeout(function () { flash.style.opacity = '0.9'; }, 350);
            setTimeout(function () { flash.style.opacity = '0.2'; }, 500);
            setTimeout(function () { flash.style.opacity = '1.0'; flash.style.transition = 'opacity 0.6s'; }, 650);
        }, 1200);

        // ── Phase 3: 黑幕淡入 + 文字 (2.8s 時觸發) ──────────────
        setTimeout(function () {
            var blackout = document.createElement('div');
            blackout.style.cssText = [
                'position:absolute;top:0;left:0;width:100%;height:100%',
                'background:#000;opacity:0',
                'transition:opacity 1.2s ease-in',
                'display:flex;flex-direction:column',
                'align-items:center;justify-content:center',
            ].join(';');
            overlay.appendChild(blackout);

            // 主文字
            var title = document.createElement('div');
            title.style.cssText = [
                'font-family:"Courier New",monospace',
                'font-size:52px;font-weight:bold',
                'color:#d4c89a;letter-spacing:10px',
                'text-align:center;opacity:0',
                'text-shadow:0 0 30px rgba(212,200,154,0.6),0 0 60px rgba(212,200,154,0.3)',
                'transition:opacity 1.5s ease-in 0.8s',
            ].join(';');
            title.textContent = 'YOU ESCAPED';
            blackout.appendChild(title);

            // 副文字
            var sub = document.createElement('div');
            sub.style.cssText = [
                'font-family:"Courier New",monospace',
                'font-size:14px;color:#666',
                'letter-spacing:6px;margin-top:24px',
                'text-align:center;opacity:0',
                'transition:opacity 1.2s ease-in 1.8s',
            ].join(';');
            sub.textContent = 'LEVEL 0 — CLEARED';
            blackout.appendChild(sub);

            // 小字提示
            var hint = document.createElement('div');
            hint.style.cssText = [
                'font-family:"Courier New",monospace',
                'font-size:11px;color:#333',
                'letter-spacing:4px;margin-top:60px',
                'text-align:center;opacity:0',
                'transition:opacity 1s ease-in 3s',
            ].join(';');
            hint.textContent = 'returning to lobby in 5 seconds...';
            blackout.appendChild(hint);

            // 掃描線遮罩
            var scanlines = document.createElement('div');
            scanlines.style.cssText = [
                'position:absolute;top:0;left:0;width:100%;height:100%',
                'background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.12) 2px,rgba(0,0,0,0.12) 4px)',
                'pointer-events:none',
            ].join(';');
            blackout.appendChild(scanlines);

            // 啟動淡入
            setTimeout(function () { blackout.style.opacity = '1'; }, 80);
            setTimeout(function () { title.style.opacity = '1'; }, 100);
            setTimeout(function () { sub.style.opacity = '1'; }, 100);
            setTimeout(function () { hint.style.opacity = '1'; }, 100);

            // ★ 真正的倒數計秒
            var _countdown = 5;
            var _countTimer = setInterval(function () {
                _countdown--;
                if (_countdown <= 0) {
                    clearInterval(_countTimer);
                    hint.textContent = 'returning to lobby...';
                } else {
                    hint.textContent = 'returning to lobby in ' + _countdown + ' second' + (_countdown === 1 ? '' : 's') + '...';
                }
            }, 1000);

            // 閃爍效果（逃脫後 title 輕微閃爍）
            setTimeout(function () {
                var blinkCount = 0;
                var blinkInterval = setInterval(function () {
                    title.style.textShadow = blinkCount % 2 === 0
                        ? '0 0 50px rgba(212,200,154,0.9),0 0 100px rgba(212,200,154,0.5)'
                        : '0 0 30px rgba(212,200,154,0.4)';
                    blinkCount++;
                    if (blinkCount > 6) clearInterval(blinkInterval);
                }, 600);
            }, 2500);

        }, 2800);

        // Phase 3 觸發後 3 秒自動回主選單
        setTimeout(function () {
            _returnToMenu();
        }, 2800 + 5000);

        console.log('[Victor] 逃脫成功！密碼：' + _password);
    }

    // ================================================================
    //  _returnToMenu — 重置遊戲狀態並回主選單
    // ================================================================
    function _returnToMenu() {
        if (document.pointerLockElement) document.exitPointerLock();

        // ★ 音效：勝利結束，回主選單 → prepare.mp3
        if (typeof AudioManager !== 'undefined') AudioManager.onReturnToMenu();

        // ★ 正確停止 main.js 的 loop（_loopRunning 是 main.js 的 var，
        //   不在 window 上；透過全域 gameActive 間接讓 loop 下一幀自行結束）
        window.gameActive = false;
        // 同時嘗試直接設（若 main.js 版本有把它掛在 window 上則生效）
        if (typeof window._loopRunning !== 'undefined') window._loopRunning = false;
        // 使用 main.js 提供的全域停止旗標（最可靠）
        if (typeof _loopRunning !== 'undefined') {
            try { _loopRunning = false; } catch(e) {}
        }

        // ★ 重置死亡/怪物狀態（避免下次開始有殘留）
        if (typeof _isDead !== 'undefined')    { try { _isDead = false; } catch(e) {} }
        if (typeof _killerNPC !== 'undefined') { try { _killerNPC = null; } catch(e) {} }
        if (typeof _npcs !== 'undefined')      { try { _npcs.length = 0; } catch(e) {} }

        // ★ 重置暫停系統
        if (typeof PauseManager !== 'undefined') {
            // 強制重置內部 _paused 狀態，收起暫停 overlay，隱藏暫停按鈕
            var pauseOverlay = document.getElementById('pause-overlay');
            if (pauseOverlay) pauseOverlay.classList.remove('open');
            var pauseBtn = document.getElementById('pause-btn');
            if (pauseBtn) pauseBtn.style.display = 'none';
        }

        // 重置 Victor 自身的狀態
        reset();

        // ★ 隱藏整個 Victor UI 容器（含 hintCanvas 的 3D 框、notifyEl）
        if (_ui) _ui.style.display = 'none';

        // ★ 清除 hintCanvas 殘留畫面
        if (_hintCanvas) {
            var hctx = _hintCanvas.getContext('2d');
            hctx.clearRect(0, 0, _hintCanvas.width, _hintCanvas.height);
            _hintCanvas.style.display = 'none';
        }

        // ★ 隱藏手電筒電量 HUD（透過模組方法，確保時序正確）
        if (typeof Flashlight !== 'undefined') Flashlight.hideHUD();

        // 移除逃脫動畫 overlay
        var overlay = document.getElementById('victor-escape-overlay');
        if (overlay) overlay.remove();

        var menu      = document.getElementById('menu');
        var bg        = document.getElementById('bg');
        var crosshair = document.getElementById('crosshair');
        var hud       = document.getElementById('hud');
        var cursor    = document.getElementById('cursor');

        if (menu)      menu.classList.remove('hide');
        if (bg)        bg.classList.remove('hide');
        if (crosshair) crosshair.classList.remove('show');
        if (hud)       hud.style.display = 'none';
        if (cursor) {
            cursor.classList.remove('hidden');
            cursor.style.display = '';   // ★ 清除 pauseManager 設的 display:none
        }
        document.body.style.cursor = 'none';   // ★ 還原自訂游標模式

        console.log('[Victor] 已回主選單');
    }

    // ================================================================
    //  update — 每幀由 main.js loop() 呼叫
    //  projMat / viewMat: Matrix4，用於 3D→螢幕投影
    // ================================================================
    function update(projMat, viewMat) {
        _projMat = projMat;
        _viewMat = viewMat;

        // 清除上幀提示框
        if (_hintCanvas) {
            var hctx = _hintCanvas.getContext('2d');
            hctx.clearRect(0, 0, _hintCanvas.width, _hintCanvas.height);
        }

        if (_escaped || _terminalOpen || !_notifyEl) return;
        if (typeof Move === 'undefined') return;

        var _pos = Move.getPos();
        var px = _pos.x, py = _pos.y, pz = _pos.z;

        // ── 終端機 ──────────────────────────────────────────────
        var td = _dist3(px, py, pz, VICTOR_TERMINAL_POS_X, VICTOR_TERMINAL_POS_Y, VICTOR_TERMINAL_POS_Z);
        var terminalVisible = (td < VICTOR_TERMINAL_DIST) && !_hasWallBetween(px, py, pz, VICTOR_TERMINAL_POS_X, py, VICTOR_TERMINAL_POS_Z);

        // 終端機 3D 框（1.0 × 0.7 世界單位的長方形）
        _draw3DBox(VICTOR_TERMINAL_POS_X, VICTOR_TERMINAL_POS_Y, VICTOR_TERMINAL_POS_Z, VICTOR_TERMINAL_W, VICTOR_TERMINAL_H, terminalVisible, 0, 0, 0);

        if (terminalVisible) {
            _notifyEl.innerHTML = '[ 點擊左鍵 ] 使用終端機<br><span style="font-size:11px;color:#666">收集：' + _collected.length + '/10 張</span>';
            _notifyEl.style.opacity = '1';
            return;
        }

        // ── 紙張 ────────────────────────────────────────────────
        if (typeof Paper !== 'undefined') {
            var papers = Paper.getPapers();
            var minDist = VICTOR_PICK_DIST;
            var nearPaper = null;
            for (var i = 0; i < papers.length; i++) {
                if (papers[i].collected) continue;
                var d = _dist3(px, py, pz, papers[i].x, papers[i].y, papers[i].z);
                if (d < minDist && !_hasWallBetween(px, py, pz, papers[i].x, py, papers[i].z)) {
                    minDist = d; nearPaper = papers[i];
                }
            }
            if (nearPaper) {
                // 紙張 3D 框（與 paper.js PAPER_WIDTH / PAPER_HEIGHT 一致）
                var PW = VICTOR_PAPER_W !== null ? VICTOR_PAPER_W : (typeof PAPER_WIDTH  !== 'undefined' ? PAPER_WIDTH  : 0.6);
                var PH = VICTOR_PAPER_H !== null ? VICTOR_PAPER_H : (typeof PAPER_HEIGHT !== 'undefined' ? PAPER_HEIGHT : 0.8);
                _draw3DBox(nearPaper.x, nearPaper.y, nearPaper.z, PW, PH, true, nearPaper.rotX, nearPaper.rotY, nearPaper.rotZ);
                _notifyEl.textContent = '[ 點擊左鍵 ] 撿起紙張';
                _notifyEl.style.opacity = '1';
                return;
            }
        }

        _notifyEl.style.opacity = '0';
    }

    // ================================================================
    //  _draw3DBox — 把世界座標的長方形投影到螢幕並畫出外框
    //  cx/cy/cz : 中心點，w/h : 寬高（世界單位）
    //  aimed    : true = 實線亮框 / false = 虛線暗框
    // ================================================================
    // rotX/rotY/rotZ 為度數，旋轉順序與 paper.js 一致（Y → X → Z）
    function _draw3DBox(cx, cy, cz, w, h, aimed, rotX, rotY, rotZ) {
        if (!_hintCanvas || !_projMat || !_viewMat) return;

        rotX = (rotX || 0) * Math.PI / 180;
        rotY = (rotY || 0) * Math.PI / 180;
        rotZ = (rotZ || 0) * Math.PI / 180;

        var hw = w / 2, hh = h / 2;
        // 四個角在本地空間（紙張平面為 XY，法線朝 +Z）
        var local = [
            { x: -hw, y: -hh, z: 0 },
            { x:  hw, y: -hh, z: 0 },
            { x:  hw, y:  hh, z: 0 },
            { x: -hw, y:  hh, z: 0 },
        ];

        // 依照 paper.js 旋轉順序：先 rotY → 再 rotX → 再 rotZ
        function rotateY(p, a) {
            var c = Math.cos(a), s = Math.sin(a);
            return { x: c*p.x + s*p.z, y: p.y, z: -s*p.x + c*p.z };
        }
        function rotateX(p, a) {
            var c = Math.cos(a), s = Math.sin(a);
            return { x: p.x, y: c*p.y - s*p.z, z: s*p.y + c*p.z };
        }
        function rotateZ(p, a) {
            var c = Math.cos(a), s = Math.sin(a);
            return { x: c*p.x - s*p.y, y: s*p.x + c*p.y, z: p.z };
        }

        // cuon-matrix rotate() 是右乘（post-multiply），
        // 程式碼寫 rotY→rotX→rotZ，實際作用在頂點是 Z→X→Y
        var corners = local.map(function (p) {
            p = rotateZ(p, rotZ);
            p = rotateX(p, rotX);
            p = rotateY(p, rotY);
            return { x: cx + p.x, y: cy + p.y, z: cz + p.z };
        });

        var pts = corners.map(function (p) {
            return _worldToScreen(p.x, p.y, p.z);
        });

        if (pts.some(function (p) { return p === null; })) return;

        var hctx = _hintCanvas.getContext('2d');
        var alpha = aimed ? 0.95 : 0.35;
        hctx.strokeStyle = 'rgba(255,230,150,' + alpha + ')';
        hctx.lineWidth   = aimed ? 2.5 : 1.2;
        hctx.setLineDash(aimed ? [] : [6, 4]);
        hctx.beginPath();
        hctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) hctx.lineTo(pts[i].x, pts[i].y);
        hctx.closePath();
        hctx.stroke();
        hctx.setLineDash([]);

        if (aimed) {
            // 最小 Y（框頂）上方顯示提示文字
            var minY = Math.min(pts[0].y, pts[1].y, pts[2].y, pts[3].y);
            var midX = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
            hctx.fillStyle    = 'rgba(255,230,150,0.9)';
            hctx.font         = 'bold 13px "Courier New",monospace';
            hctx.textAlign    = 'center';
            hctx.textBaseline = 'bottom';
            hctx.fillText('[ LMB ]', midX, minY - 6);
        }
    }

    // ================================================================
    //  _worldToScreen — 3D → 螢幕像素（回傳 null 表示在鏡頭後方）
    // ================================================================
    function _worldToScreen(wx, wy, wz) {
        if (!_projMat || !_viewMat) return null;
        var vp = _viewMat.elements;
        var pp = _projMat.elements;
        var ex = vp[0]*wx + vp[4]*wy + vp[8]*wz  + vp[12];
        var ey = vp[1]*wx + vp[5]*wy + vp[9]*wz  + vp[13];
        var ez = vp[2]*wx + vp[6]*wy + vp[10]*wz + vp[14];
        var ew = vp[3]*wx + vp[7]*wy + vp[11]*wz + vp[15];
        var cx = pp[0]*ex + pp[4]*ey + pp[8]*ez  + pp[12]*ew;
        var cy = pp[1]*ex + pp[5]*ey + pp[9]*ez  + pp[13]*ew;
        var cz = pp[2]*ex + pp[6]*ey + pp[10]*ez + pp[14]*ew;
        var cw = pp[3]*ex + pp[7]*ey + pp[11]*ez + pp[15]*ew;
        if (cw <= 0) return null;
        return {
            x: ( cx / cw + 1) * 0.5 * _hintCanvas.width,
            y: (-cy / cw + 1) * 0.5 * _hintCanvas.height,
        };
    }

    // ================================================================
    //  _hasWallBetween — 線段 vs 牆 AABB 相交測試（slab method）
    //  不依賴採樣步距，任意厚度的牆都不會被穿過
    //  回傳 true = 有牆擋住（不可互動）
    // ================================================================
    function _hasWallBetween(x1, y1, z1, x2, y2, z2) {
        if (typeof Physics === 'undefined') return false;
        var walls = Physics.getWalls();
        if (!walls || walls.length === 0) return false;

        var dirX = x2 - x1, dirY = y2 - y1, dirZ = z2 - z1;

        for (var i = 0; i < walls.length; i++) {
            var w = walls[i];

            // ── 1. Y 軸：射線水平化後用玩家眼睛高度做點檢測 ────
            // y1 == y2（水平射線），只要眼睛高度在牆的 Y 範圍內即可
            var eyeY = y1;
            if (eyeY < w.minY - 0.5 || eyeY > w.maxY + 0.5) continue;

            // ── 2. XZ slab（slab method，t 在 [0,1] 內代表線段範圍）
            var tMin = 0, tMax = 1;

            // X slab
            if (Math.abs(dirX) < 1e-9) {
                // 方向平行 X 軸 → 起點必須在牆的 X 範圍內
                if (x1 < w.minX || x1 > w.maxX) continue;
            } else {
                var tx1 = (w.minX - x1) / dirX;
                var tx2 = (w.maxX - x1) / dirX;
                if (tx1 > tx2) { var tmp = tx1; tx1 = tx2; tx2 = tmp; }
                tMin = Math.max(tMin, tx1);
                tMax = Math.min(tMax, tx2);
                if (tMin > tMax) continue;
            }

            // Z slab
            if (Math.abs(dirZ) < 1e-9) {
                if (z1 < w.minZ || z1 > w.maxZ) continue;
            } else {
                var tz1 = (w.minZ - z1) / dirZ;
                var tz2 = (w.maxZ - z1) / dirZ;
                if (tz1 > tz2) { var tmp2 = tz1; tz1 = tz2; tz2 = tmp2; }
                tMin = Math.max(tMin, tz1);
                tMax = Math.min(tMax, tz2);
                if (tMin > tMax) continue;
            }

            // ── 3. 交點必須不在起點或終點本身（容差 0.05）──────────
            // 避免玩家或目標本身就在牆的 AABB 邊緣而誤判
            if (tMax < 0.05 || tMin > 0.95) continue;

            return true;   // 有牆擋住
        }

        return false;
    }

    // ================================================================
    //  _updateMemoryHUD — 更新左上角已收集紙張顯示
    //  上排：數字紙的 content（顏色對應），下排：字母紙的 content
    // ================================================================
    function _updateMemoryHUD() {
        if (!_memoryEl) return;

        var numbers = _collected.filter(function (c) { return c.type === 'number'; });
        var letters = _collected.filter(function (c) { return c.type === 'letter'; });

        if (_collected.length === 0) {
            _memoryEl.style.opacity = '0';
            return;
        }

        // 顏色對照 → CSS 顏色
        var CSS_COLOR = {
            red:    '#ff4444',
            yellow: '#f5dd22',
            blue:   '#4488ff',
            green:  '#44cc55',
            white:  '#ffffff',
            black:  '#888888',
        };

        // 建立佔位格（5 格，未收集的顯示 _ ）
        function buildRow(items, total) {
            // 依顏色排序，讓同色的數字/字母對齊
            // 用 slot 陣列，按 color 配對填入
            var slots = [];
            for (var i = 0; i < total; i++) slots.push(null);
            items.forEach(function (c) { slots.push(c); });
            // 實際只取最後 total 筆（簡化：直接依收集順序顯示）
            return items;
        }

        // 上排數字
        var numHTML = '';
        for (var i = 0; i < 5; i++) {
            if (i < numbers.length) {
                var nc = CSS_COLOR[numbers[i].color] || '#c8b87a';
                numHTML += '<span style="color:' + nc + ';margin-right:10px;text-shadow:0 0 6px ' + nc + '88">'
                         + numbers[i].content + '</span>';
            } else {
                numHTML += '<span style="color:#333;margin-right:10px">_</span>';
            }
        }

        // 下排字母
        var letHTML = '';
        for (var j = 0; j < 5; j++) {
            if (j < letters.length) {
                var lc = CSS_COLOR[letters[j].color] || '#c8b87a';
                letHTML += '<span style="color:' + lc + ';margin-right:10px;text-shadow:0 0 6px ' + lc + '88">'
                         + letters[j].content + '</span>';
            } else {
                letHTML += '<span style="color:#333;margin-right:10px">_</span>';
            }
        }

        _memoryEl.innerHTML =
            '<div style="color:#665f3a;letter-spacing:3px;font-size:10px;margin-bottom:7px">YOUR MEMORY :</div>' +
            '<div style="font-size:15px;letter-spacing:6px;margin-bottom:5px">' + numHTML + '</div>' +
            '<div style="font-size:15px;letter-spacing:6px">' + letHTML + '</div>';

        _memoryEl.style.opacity = '1';
    }

    // ================================================================
    //  _log — 收集記錄（console）
    // ================================================================
    function _log(msg) {
        console.log('[Victor]', msg);
    }

    // ================================================================
    //  工具：3D 距離
    // ================================================================
    function _dist3(x1, y1, z1, x2, y2, z2) {
        var dx = x1 - x2, dy = y1 - y2, dz = z1 - z2;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }

    // ================================================================
    //  resetUI — 重置 UI 狀態但保留記憶（死亡重生時呼叫）
    // ================================================================
    function resetUI() {
        _terminalOpen = false;
        _escaped      = false;
        _password     = '';
        _inputBuffer  = '';

        // 清除逃脫動畫 overlay（若還殘留）
        var overlay = document.getElementById('victor-escape-overlay');
        if (overlay) overlay.remove();

        // 重置終端機 UI
        if (_terminalEl) {
            _terminalEl.style.opacity       = '0';
            _terminalEl.style.pointerEvents = 'none';
            _terminalEl.style.borderColor   = '#3a3a2a';
            var vtLog = document.getElementById('vt-log');
            if (vtLog) vtLog.innerHTML = '';
            var vtInput = document.getElementById('vt-input');
            if (vtInput) vtInput.textContent = '';
        }
        // 重置紙張預覽 UI
        if (_paperViewEl) {
            _paperViewEl.style.opacity       = '0';
            _paperViewEl.style.pointerEvents = 'none';
            var card = document.getElementById('victor-paper-card');
            if (card) card.innerHTML = '';
        }
        // 重置提示
        if (_notifyEl) {
            _notifyEl.style.opacity = '0';
            _notifyEl.textContent   = '';
        }

        // 重新顯示 UI 容器與 hintCanvas
        if (_ui) _ui.style.display = '';
        if (_hintCanvas) {
            var hctx = _hintCanvas.getContext('2d');
            hctx.clearRect(0, 0, _hintCanvas.width, _hintCanvas.height);
            _hintCanvas.style.display = '';
        }

        // 確保 InputLock 釋放
        if (typeof InputLock !== 'undefined') {
            InputLock.release('victor-paper');
            InputLock.release('victor-terminal');
        }

        // 重新渲染記憶 HUD（_collected 保留不清）
        _updateMemoryHUD();

        console.log('[Victor] UI 已重置（記憶保留，共 ' + _collected.length + ' 張）');
    }

    // ================================================================
    //  reset — 重置所有內部狀態（回主選單後、再次開始前呼叫）
    // ================================================================
    function reset() {
        _collected    = [];
        _terminalOpen = false;
        _escaped      = false;
        _password     = '';
        _inputBuffer  = '';

        // 清除逃脫動畫 overlay（若還殘留）
        var overlay = document.getElementById('victor-escape-overlay');
        if (overlay) overlay.remove();

        // 重置終端機 UI
        if (_terminalEl) {
            _terminalEl.style.opacity       = '0';
            _terminalEl.style.pointerEvents = 'none';
            // ★ 重啟修正：清除上一局的 terminal log 與紅色錯誤邊框
            _terminalEl.style.borderColor   = '#3a3a2a';
            var vtLog = document.getElementById('vt-log');
            if (vtLog) vtLog.innerHTML = '';
            var vtInput = document.getElementById('vt-input');
            if (vtInput) vtInput.textContent = '';
        }
        // 重置紙張預覽 UI
        if (_paperViewEl) {
            _paperViewEl.style.opacity      = '0';
            _paperViewEl.style.pointerEvents = 'none';
            // ★ 重啟修正：清除上一局的紙張卡片內容
            var card = document.getElementById('victor-paper-card');
            if (card) card.innerHTML = '';
        }
        // 重置提示
        if (_notifyEl) {
            _notifyEl.style.opacity = '0';
            _notifyEl.textContent   = '';
        }

        // 重置記憶 HUD
        if (_memoryEl) {
            _memoryEl.style.opacity = '0';
            _memoryEl.innerHTML     = '';
        }

        // ★ 重新顯示 UI 容器與 hintCanvas（給下一局使用）
        if (_ui) _ui.style.display = '';
        if (_hintCanvas) {
            // ★ 重啟修正：清除殘留畫面再顯示
            var hctx = _hintCanvas.getContext('2d');
            hctx.clearRect(0, 0, _hintCanvas.width, _hintCanvas.height);
            _hintCanvas.style.display = '';
        }

        // 確保 InputLock 釋放
        if (typeof InputLock !== 'undefined') {
            InputLock.release('victor-paper');
            InputLock.release('victor-terminal');
        }

        console.log('[Victor] 狀態已重置');
    }

    // ================================================================
    //  forceClose — 死亡時由 dead.js 呼叫，強制關閉所有 UI
    // ================================================================
    function forceClose() {
        // 關終端機
        if (_terminalOpen) _closeTerminal();

        // 關紙張預覽
        if (_paperViewEl && _paperViewEl.style.opacity === '1') _closePaperView();

        // 釋放所有 InputLock
        if (typeof InputLock !== 'undefined') {
            InputLock.release('victor-paper');
            InputLock.release('victor-terminal');
        }

        // ★ 隱藏記憶 HUD
        if (_memoryEl) {
            _memoryEl.style.opacity = '0';
            _memoryEl.innerHTML     = '';
        }

        // ★ 清除 hintCanvas 殘留畫面
        if (_hintCanvas) {
            var hctx = _hintCanvas.getContext('2d');
            hctx.clearRect(0, 0, _hintCanvas.width, _hintCanvas.height);
            _hintCanvas.style.display = 'none';
        }

        // ★ 隱藏整個 Victor UI 容器
        if (_ui) _ui.style.display = 'none';

        console.log('[Victor] forceClose — UI 已強制關閉');
    }

    // ================================================================
    //  Public API
    // ================================================================
    return {
        init        : init,
        reset       : reset,
        resetUI     : resetUI,
        update      : update,
        forceClose  : forceClose,
        getCollected: function () { return _collected; },
        getPassword : function () { return _password;  },
    };

})();