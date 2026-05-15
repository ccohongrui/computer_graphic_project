// ================================================================
//  instruction.js — 開發者指令控制台
//
//  按 T 開關主控台。
//  輸入指令後按 Enter 執行。
//  輸入 ./help 查看所有可用指令。
//  支援上下方向鍵瀏覽歷史指令。
// ================================================================

var Instruction = (function () {

    // ── DOM refs ─────────────────────────────────────────────────
    var _panel = null;
    var _output = null;
    var _inputEl = null;
    var _open = false;
    var _initialized = false;  // ★ 防止重複 init 疊加監聽器

    // ── 指令歷史 ─────────────────────────────────────────────────
    var _history = [];
    var _histIdx = -1;
    var _draft = '';   // 使用歷史前暫存當前輸入

    // ================================================================
    //  init — 在 main() 末尾呼叫（或由 game.html 的 script 呼叫）
    // ================================================================
    function init() {
        if (_initialized) {
            // ★ 已初始化過：只重置狀態，不重建 DOM / 重綁監聽器
            reset();
            return;
        }
        _initialized = true;
        _buildUI();
        _bindKeys();
        console.log('[Instruction] 控制台就緒，按 T 開關');
    }

    // ================================================================
    //  reset — 退出遊戲 / 重新開始時呼叫，清理面板狀態
    // ================================================================
    function reset() {
        // 若面板是開著的，先靜默關閉
        if (_open) {
            _open = false;
            if (typeof InputLock !== 'undefined') InputLock.release('instruction');
            if (_panel) _panel.classList.remove('open');
            if (_inputEl) _inputEl.blur();
        }
        console.log('[Instruction] 狀態已重置');
    }

    // ================================================================
    //  _buildUI
    // ================================================================
    function _buildUI() {
        /* ── 注入必要 CSS ── */
        var style = document.createElement('style');
        style.textContent = [
            '#instr-panel{',
            'position:fixed;bottom:0;left:0;right:0;',
            'height:260px;',
            'background:rgba(8,8,6,0.93);',
            'border-top:1px solid #3a3820;',
            'font-family:"Courier New",Courier,monospace;',
            'font-size:13px;',
            'color:#c8bb88;',
            'display:flex;flex-direction:column;',
            'z-index:99999;',
            'transform:translateY(100%);',
            'transition:transform 0.22s cubic-bezier(0.22,1,0.36,1);',
            'user-select:text;',
            '}',
            '#instr-panel.open{ transform:translateY(0); }',

            '#instr-topbar{',
            'display:flex;align-items:center;justify-content:space-between;',
            'padding:5px 14px 4px;',
            'border-bottom:1px solid #2a2818;',
            'background:rgba(20,18,10,0.95);',
            'flex-shrink:0;',
            '}',
            '#instr-topbar span{',
            'letter-spacing:3px;font-size:10px;color:#6a6040;',
            '}',
            '#instr-topbar kbd{',
            'font-size:10px;color:#4a4030;letter-spacing:1px;',
            '}',

            '#instr-output{',
            'flex:1;overflow-y:auto;',
            'padding:8px 14px 4px;',
            'line-height:1.7;',
            '}',
            '#instr-output::-webkit-scrollbar{ width:4px; }',
            '#instr-output::-webkit-scrollbar-thumb{ background:#3a3820; }',

            '#instr-output .line-info  { color:#c8bb88; }',
            '#instr-output .line-ok    { color:#88bb88; }',
            '#instr-output .line-warn  { color:#d4a04a; }',
            '#instr-output .line-err   { color:#cc4444; }',
            '#instr-output .line-cmd   { color:#8899bb; }',
            '#instr-output .line-head  { color:#eecc66;letter-spacing:1px; }',
            '#instr-output .line-sub   { color:#8a8060;padding-left:18px; }',

            '#instr-inputrow{',
            'display:flex;align-items:center;',
            'padding:6px 14px 8px;',
            'border-top:1px solid #2a2818;',
            'flex-shrink:0;',
            '}',
            '#instr-prompt{ color:#d4c060;margin-right:8px;flex-shrink:0; }',
            '#instr-input{',
            'flex:1;background:transparent;border:none;outline:none;',
            'color:#e8dda0;font-family:inherit;font-size:13px;',
            'caret-color:#d4c060;',
            '}',
        ].join('');
        document.head.appendChild(style);

        /* ── 面板結構 ── */
        _panel = document.createElement('div');
        _panel.id = 'instr-panel';
        _panel.innerHTML =
            '<div id="instr-topbar">' +
            '<span>BACKROOMS DEV CONSOLE</span>' +
            '<kbd>T to toggle · ESC to close</kbd>' +
            '</div>' +
            '<div id="instr-output"></div>' +
            '<div id="instr-inputrow">' +
            '<span id="instr-prompt">&gt;</span>' +
            '<input id="instr-input" type="text" autocomplete="off" spellcheck="false" placeholder="輸入指令... 或 ./help">' +
            '</div>';
        document.body.appendChild(_panel);

        _output = document.getElementById('instr-output');
        _inputEl = document.getElementById('instr-input');

        _print('info', '=== BACKROOMS DEV CONSOLE ===');
        _print('info', '輸入 ./help 查看所有指令類別');
    }

    // ================================================================
    //  _bindKeys
    // ================================================================
    function _bindKeys() {
        // ── capture 階段攔截（與 InputLock 同優先，確保能收到按鍵）──
        // 注意：capture=true，在 InputLock 的 stopPropagation 之前執行
        document.addEventListener('keydown', function (e) {

    // T 鍵開關（只要不在 input 打字就能觸發）
            if (e.code === 'KeyT' && document.activeElement !== _inputEl) {
                // ★ 檢查 Console 存取權限
                if (window._settingConsoleEnabled === false) return;
                e.preventDefault();
                e.stopPropagation();
                _toggle();
                return;
            }

            if (!_open) return;

            // 面板開啟時攔截所有鍵，防止遊戲邏輯收到
            e.stopPropagation();

            switch (e.code) {
                case 'Enter':
                    e.preventDefault();
                    _submit();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    _historyNav(-1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    _historyNav(1);
                    break;
                case 'Escape':
                    e.preventDefault();
                    _close();
                    break;
            }

        }, true);   // ← capture = true

        // 點擊面板時，讓輸入框獲得焦點
        _panel.addEventListener('click', function () {
            _inputEl.focus();
        });
    }

    // ================================================================
    //  開關面板
    // ================================================================
    function _toggle() { _open ? _close() : _openPanel(); }

    function _openPanel() {
        _open = true;
        _panel.classList.add('open');
        if (typeof InputLock !== 'undefined') InputLock.claim('instruction');
        // 先退出 Pointer Lock，再用較長延遲確保瀏覽器把焦點還給我們
        if (document.pointerLockElement) document.exitPointerLock();
        setTimeout(function () { _inputEl.focus(); }, 150);
    }

    function _close() {
        _open = false;
        if (typeof InputLock !== 'undefined') InputLock.release('instruction');
        _panel.classList.remove('open');
        _inputEl.blur();
    }

    // ================================================================
    //  歷史導航
    // ================================================================
    function _historyNav(dir) {
        if (_history.length === 0) return;

        if (_histIdx === -1) {
            _draft = _inputEl.value;
        }

        _histIdx = Math.max(-1, Math.min(_history.length - 1, _histIdx + dir));

        if (_histIdx === -1) {
            _inputEl.value = _draft;
        } else {
            _inputEl.value = _history[_history.length - 1 - _histIdx];
        }
    }

    // ================================================================
    //  提交指令
    // ================================================================
    function _submit() {
        var raw = _inputEl.value.trim();
        if (!raw) return;

        _inputEl.value = '';
        _histIdx = -1;
        _draft = '';

        // 存入歷史（避免連續重複）
        if (_history[_history.length - 1] !== raw) _history.push(raw);
        if (_history.length > 50) _history.shift();

        _print('cmd', '> ' + raw);
        _execute(raw);
        _scrollBottom();
    }

    // ================================================================
    //  輸出工具
    // ================================================================
    function _print(cls, text) {
        if (!_output) return;
        var line = document.createElement('div');
        line.className = 'line-' + cls;
        line.textContent = text;
        _output.appendChild(line);
        _scrollBottom();
    }

    function _scrollBottom() {
        if (_output) _output.scrollTop = _output.scrollHeight;
    }

    // ================================================================
    //  指令執行核心
    // ================================================================
    function _execute(raw) {
        var parts = raw.trim().split(/\s+/);
        var cmd = parts[0].toLowerCase();

        // ── ./help ──────────────────────────────────────────────
        if (cmd === './help' || cmd === 'help') {
            var sub = (parts[1] || '').toLowerCase();
            _cmdHelp(sub);
            return;
        }

        // ── 通用 set / get ───────────────────────────────────────
        if (cmd === 'set') { _cmdSet(parts); return; }
        if (cmd === 'get') { _cmdGet(parts); return; }

        // ── 玩家 ────────────────────────────────────────────────
        if (cmd === 'tp' || cmd === 'teleport') { _cmdTp(parts); return; }
        if (cmd === 'setpos') { _cmdTp(parts); return; }
        if (cmd === 'getpos') { _cmdGetPos(); return; }
        if (cmd === 'settheta') { _cmdSetAngle('theta', parts[1]); return; }
        if (cmd === 'setphi') { _cmdSetAngle('phi', parts[1]); return; }

        // ── 遊戲狀態 ─────────────────────────────────────────────
        if (cmd === 'die' || cmd === 'kill') { _cmdDie(); return; }
        if (cmd === 'win' || cmd === 'escape') { _cmdWin(); return; }
        if (cmd === 'answer') { _cmdAnswer(); return; }
        if (cmd === 'peace') { _cmdPeace(parts); return; }
        if (cmd === 'night') { _cmdNight(parts); return; }

        // ── 怪物 ────────────────────────────────────────────────
        if (cmd === 'npc') { _cmdNpc(parts); return; }
        if (cmd === 'clearnpc' || cmd === 'killnpc') { _cmdClearNpc(); return; }
        if (cmd === 'spawnnpc') { _cmdSpawnNpc(parts); return; }

        // ── 光 / 手電筒 ──────────────────────────────────────────
        if (cmd === 'ambient') { _cmdAmbient(parts); return; }
        if (cmd === 'flashlight') { _cmdFlashlight(parts); return; }

        // ── 移動速度 ─────────────────────────────────────────────
        if (cmd === 'speed') { _cmdSpeed(parts); return; }
        if (cmd === 'noclip') { _cmdNoclip(); return; }

        // ── 其他 ─────────────────────────────────────────────────
        if (cmd === 'clear' || cmd === 'cls') { _output.innerHTML = ''; return; }
        if (cmd === 'list') { _cmdList(); return; }
        if (cmd === 'eval') { _cmdEval(parts.slice(1).join(' ')); return; }

        _print('err', '未知指令：' + cmd + '　輸入 ./help 查看說明');
    }

    // ================================================================
    //  ── 指令實作 ──
    // ================================================================

    // ── ./help ──────────────────────────────────────────────────────
    function _cmdHelp(sub) {
        switch (sub) {
            case 'player':
                _print('head', '【玩家控制】');
                _print('sub', 'tp <x> <y> <z>        — 傳送到指定座標');
                _print('sub', 'getpos                 — 顯示當前座標');
                _print('sub', 'settheta <度>          — 設定水平視角');
                _print('sub', 'setphi <度>            — 設定垂直仰角（-89~89）');
                _print('sub', 'speed <倍率>           — 移動速度倍率（1=正常）');
                _print('sub', 'noclip                 — 穿牆模式切換（★尚未實作物理繞過）');
                break;
            case 'game':
                _print('head', '【遊戲狀態】');
                _print('sub', 'die / kill             — 立即觸發死亡演出（無兇手）');
                _print('sub', 'win / escape           — 立即觸發勝利（逃脫）畫面');
                _print('sub', 'answer                 — 顯示當前謎題密碼');
                _print('sub', 'peace [on|off]         — 和平模式開關（影響下次生成）');
                _print('sub', 'night [on|off]         — 強制切換日夜（若 Stage 支援）');
                break;
            case 'npc':
                _print('head', '【怪物控制】');
                _print('sub', 'npc list               — 列出場上所有怪物');
                _print('sub', 'npc info <id>          — 查看指定怪物詳情');
                _print('sub', 'npc kill <id>          — 移除指定怪物');
                _print('sub', 'npc killall            — 移除所有怪物');
                _print('sub', 'npc chase <id> [on|off]— 切換追逐狀態');
                _print('sub', 'npc tp <id> <x> <y> <z>— 傳送怪物');
                _print('sub', 'npc speed <id> <v>     — 改變怪物追逐速度');
                _print('sub', 'clearnpc               — 同 npc killall');
                _print('sub', 'spawnnpc               — 依照 NPC_SPAWN_LIST 重新生成');
                break;
            case 'var':
                _print('head', '【全域變數】');
                _print('sub', 'set <變數名> <值>      — 設定全域變數（數字/布林/字串）');
                _print('sub', 'get <變數名>           — 讀取全域變數');
                _print('sub', 'list                   — 列出常用可調變數');
                _print('sub', 'eval <JS 表達式>       — 直接執行任意 JavaScript');
                break;
            case 'light':
                _print('head', '【光源 / 環境】');
                _print('sub', 'ambient <r> <g> <b>    — 設定環境光（0~1，例：0.4 0.3 0.2）');
                _print('sub', 'flashlight [on|off]    — 切換手電筒（若 Flashlight 支援）');
                break;
            default:
                _print('head', '=== BACKROOMS DEV CONSOLE 指令說明 ===');
                _print('info', '');
                _print('info', '  ./help player    — 玩家控制（傳送、視角、速度）');
                _print('info', '  ./help game      — 遊戲狀態（死亡、勝利、密碼）');
                _print('info', '  ./help npc       — 怪物控制（列表、殺除、追逐）');
                _print('info', '  ./help var       — 全域變數讀寫 & eval');
                _print('info', '  ./help light     — 光源 & 環境色');
                _print('info', '');
                _print('info', '  常用快捷指令：');
                _print('sub', '  die / win / answer / getpos / peace / list');
                _print('info', '');
                _print('info', '  上下方向鍵 → 歷史指令；Esc → 關閉面板');
        }
    }

    // ── set ──────────────────────────────────────────────────────────
    function _cmdSet(parts) {
        if (parts.length < 3) {
            _print('warn', '用法：set <變數名> <值>');
            return;
        }
        var name = parts[1];
        var raw = parts.slice(2).join(' ');
        var val;

        if (raw === 'true') val = true;
        else if (raw === 'false') val = false;
        else if (!isNaN(Number(raw))) val = Number(raw);
        else val = raw;

        window[name] = val;
        _print('ok', name + ' = ' + JSON.stringify(val));
    }

    // ── get ──────────────────────────────────────────────────────────
    function _cmdGet(parts) {
        if (parts.length < 2) { _print('warn', '用法：get <變數名>'); return; }
        var name = parts[1];
        var val = window[name];
        if (typeof val === 'undefined') {
            _print('warn', name + ' 未定義');
        } else {
            _print('ok', name + ' = ' + JSON.stringify(val));
        }
    }

    // ── tp ───────────────────────────────────────────────────────────
    function _cmdTp(parts) {
        if (window._settingTpCmdEnabled === false) {
            _print('err', '⛔ 傳送指令已被管理員停用');
            return;
        }
        // 接受 tp x y z 或 setpos x y z
        var x = parseFloat(parts[1]);
        var y = parseFloat(parts[2]);
        var z = parseFloat(parts[3]);
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            _print('warn', '用法：tp <x> <y> <z>');
            return;
        }
        if (typeof Move !== 'undefined') {
            Move.setPos(x, y, z);
            _print('ok', '已傳送至 (' + x + ', ' + y + ', ' + z + ')');
        } else {
            _print('err', 'Move 模組未載入');
        }
    }

    // ── getpos ───────────────────────────────────────────────────────
    function _cmdGetPos() {
        if (typeof Move === 'undefined') { _print('err', 'Move 未載入'); return; }
        var p = Move.getPos();
        _print('ok', 'X=' + p.x.toFixed(3) + '  Y=' + p.y.toFixed(3) + '  Z=' + p.z.toFixed(3));
        _print('ok', 'θ=' + Move.getTheta().toFixed(1) + '°  φ=' + Move.getPhi().toFixed(1) + '°');
    }

    // ── settheta / setphi ────────────────────────────────────────────
    function _cmdSetAngle(axis, valStr) {
        var v = parseFloat(valStr);
        if (isNaN(v)) { _print('warn', '請輸入數值角度'); return; }
        if (typeof Move === 'undefined') { _print('err', 'Move 未載入'); return; }
        if (axis === 'theta') { Move.setTheta(v); _print('ok', 'Theta → ' + v + '°'); }
        else { Move.setPhi(v); _print('ok', 'Phi → ' + v + '°'); }
    }

    // ── die ──────────────────────────────────────────────────────────
    function _cmdDie() {
        if (typeof Dead === 'undefined') { _print('err', 'Dead 模組未載入'); return; }
        if (typeof _isDead !== 'undefined' && _isDead) {
            _print('warn', '目前已在死亡狀態中');
            return;
        }

        // 建立一個假的 NPC 物件滿足 Dead.trigger 的介面
        var fakeNpc = {
            cfg: { type: 'console', eyeY: 1.6 },
            getPos: function () {
                var p = (typeof Move !== 'undefined') ? Move.getPos() : { x: 0, y: 0, z: 0 };
                return { x: p.x + 2, y: 1.6, z: p.z + 2 };
            },
        };

        if (typeof onPlayerCaught === 'function') {
            onPlayerCaught(fakeNpc);
            _print('ok', '💀 死亡演出已觸發');
        } else {
            Dead.trigger(fakeNpc);
            _print('ok', '💀 死亡演出已觸發（直接呼叫 Dead.trigger）');
        }
        _close();
    }

    // ── win ──────────────────────────────────────────────────────────
    function _cmdWin() {
        if (typeof Victor === 'undefined') {
            _print('err', 'Victor 模組未載入');
            return;
        }
        // 嘗試呼叫 Victor 內部的 _triggerEscape（若已暴露），否則用 eval
        try {
            // Victor 沒有直接暴露 escape，用 eval 存取閉包
            // 先嘗試設定 _escaped 標誌
            _print('warn', 'Victor 的逃脫函式為私有閉包，嘗試強制觸發…');
            // 最安全的方式：執行 Victor 密碼驗證流程
            // 若取得 password 再透過 keydown 輸入
            var pw = Victor.getPassword ? Victor.getPassword() : null;
            if (pw) {
                _print('info', '偵測到密碼：' + pw + '，模擬輸入中…');
                // 直接呼叫 eval 執行 _submitPassword（若有暴露）
                _print('warn', '請於終端機介面手動輸入密碼：' + pw);
                _print('ok', '✅ 使用 "answer" 指令查看密碼，再到終端機輸入即可逃脫');
            } else {
                _print('warn', '尚未生成密碼（紙張尚未全部收集？）');
            }
        } catch (e) {
            _print('err', '觸發失敗：' + e.message);
        }
    }

    // ── answer ───────────────────────────────────────────────────────
    function _cmdAnswer() {
        if (typeof Victor === 'undefined') {
            _print('err', 'Victor 模組未載入');
            return;
        }
        var pw = Victor.getPassword ? Victor.getPassword() : null;
        if (!pw) {
            _print('warn', '密碼尚未生成（還沒收集足夠的紙張？）');
            var col = Victor.getCollected ? Victor.getCollected() : [];
            _print('info', '已收集紙張數：' + col.length);
            return;
        }
        _print('head', '★ 密碼：' + pw);
        var col = Victor.getCollected ? Victor.getCollected() : [];
        _print('info', '已收集紙張：' + col.length + ' 張');
    }

    // ── peace ────────────────────────────────────────────────────────
    function _cmdPeace(parts) {
        var sub = (parts[1] || '').toLowerCase();
        if (sub === 'on') window.piece = true;
        else if (sub === 'off') window.piece = false;
        else window.piece = !window.piece;
        _print('ok', '和平模式 → ' + (window.piece ? 'ON（怪物停止生成）' : 'OFF'));
    }

    // ── night ─────────────────────────────────────────────────────────
    function _cmdNight(parts) {
        if (typeof Stage === 'undefined' || typeof Stage.isNight === 'undefined') {
            _print('err', 'Stage 未載入或不支援 isNight');
            return;
        }
        var sub = (parts[1] || '').toLowerCase();
        var forceNight = sub === 'on' ? true
            : sub === 'off' ? false
                : !Stage.isNight();
        if (typeof Stage.setNight === 'function') {
            Stage.setNight(forceNight);
            _print('ok', '日夜切換 → ' + (forceNight ? '夜晚' : '白天'));
        } else {
            // Stage 若沒有 setNight，嘗試直接改內部變數
            _print('warn', 'Stage.setNight 不存在，嘗試強制覆寫 Stage._night…');
            try {
                var desc = Object.getOwnPropertyDescriptor(Stage, '_night');
                if (desc && desc.set) Stage._night = forceNight;
                _print('ok', '已嘗試切換（效果視 Stage 實作而定）');
            } catch (e) {
                _print('err', '無法強制切換：' + e.message);
            }
        }
    }

    // ── npc ──────────────────────────────────────────────────────────
    function _cmdNpc(parts) {
        if (window._settingNpcCmdEnabled === false) {
            _print('err', '⛔ NPC 指令已被管理員停用');
            return;
        }
        var sub = (parts[1] || '').toLowerCase();
        var npcs = (typeof _npcs !== 'undefined') ? _npcs : [];

        switch (sub) {
            case 'list':
                if (npcs.length === 0) { _print('info', '目前場上沒有怪物'); return; }
                _print('head', '  ID │ 類型         │ 座標');
                for (var i = 0; i < npcs.length; i++) {
                    var n = npcs[i];
                    var p = n.getPos ? n.getPos() : { x: '?', y: '?', z: '?' };
                    _print('info',
                        '  [' + i + '] ' + _pad(n.cfg.type, 12) +
                        ' X=' + _f(p.x) + ' Y=' + _f(p.y) + ' Z=' + _f(p.z)
                    );
                }
                break;

            case 'info':
                var id = parseInt(parts[2]);
                if (isNaN(id) || !npcs[id]) { _print('warn', '用法：npc info <id>'); return; }
                var n2 = npcs[id];
                _print('head', '── NPC [' + id + '] ' + n2.cfg.type + ' ──');
                for (var k in n2.cfg) {
                    _print('sub', k + ' = ' + JSON.stringify(n2.cfg[k]));
                }
                break;

            case 'kill':
                var kid = parseInt(parts[2]);
                if (isNaN(kid) || !npcs[kid]) { _print('warn', '用法：npc kill <id>'); return; }
                npcs.splice(kid, 1);
                _print('ok', '已移除 NPC [' + kid + ']（剩餘 ' + npcs.length + ' 隻）');
                break;

            case 'killall':
                var cnt = npcs.length;
                npcs.length = 0;
                _print('ok', '已移除全部 ' + cnt + ' 隻怪物');
                break;

            case 'chase':
                var cid = parseInt(parts[2]);
                var onoff = (parts[3] || 'toggle').toLowerCase();
                if (isNaN(cid) || !npcs[cid]) { _print('warn', '用法：npc chase <id> [on|off]'); return; }
                var n3 = npcs[cid];
                // 嘗試直接改內部 _chasing 或 cfg.chaseSpeed
                if (onoff === 'off') {
                    n3._forceStopChase = true;
                    _print('ok', 'NPC [' + cid + '] 追逐已暫停（_forceStopChase=true）');
                } else {
                    n3._forceStopChase = false;
                    _print('ok', 'NPC [' + cid + '] 追逐已恢復');
                }
                break;

            case 'tp':
                var tid = parseInt(parts[2]);
                var tx = parseFloat(parts[3]);
                var ty = parseFloat(parts[4]);
                var tz = parseFloat(parts[5]);
                if (isNaN(tid) || !npcs[tid] || isNaN(tx) || isNaN(ty) || isNaN(tz)) {
                    _print('warn', '用法：npc tp <id> <x> <y> <z>');
                    return;
                }
                var n4 = npcs[tid];
                if (n4.setPos) { n4.setPos(tx, ty, tz); }
                else {
                    if (n4._pos) { n4._pos.x = tx; n4._pos.y = ty; n4._pos.z = tz; }
                    else if (n4.pos) { n4.pos.x = tx; n4.pos.y = ty; n4.pos.z = tz; }
                    else { n4.cfg.posX = tx; n4.cfg.posY = ty; n4.cfg.posZ = tz; }
                }
                _print('ok', 'NPC [' + tid + '] 已傳送至 (' + tx + ',' + ty + ',' + tz + ')');
                break;

            case 'speed':
                var sid = parseInt(parts[2]);
                var sv = parseFloat(parts[3]);
                if (isNaN(sid) || !npcs[sid] || isNaN(sv)) {
                    _print('warn', '用法：npc speed <id> <速度值>');
                    return;
                }
                npcs[sid].cfg.chaseSpeed = sv;
                _print('ok', 'NPC [' + sid + '] chaseSpeed → ' + sv);
                break;

            default:
                _print('warn', '用法：npc list / info / kill / killall / chase / tp / speed');
                _print('warn', '或輸入 ./help npc 查看詳細說明');
        }
    }

    // ── clearnpc ─────────────────────────────────────────────────────
    function _cmdClearNpc() {
        if (window._settingNpcCmdEnabled === false) {
            _print('err', '⛔ NPC 指令已被管理員停用');
            return;
        }
        if (typeof _npcs === 'undefined') { _print('err', '_npcs 未定義'); return; }
        var cnt = _npcs.length;
        _npcs.length = 0;
        _print('ok', '已清除所有 ' + cnt + ' 隻怪物');
    }

    // ── spawnnpc ─────────────────────────────────────────────────────
    function _cmdSpawnNpc(parts) {
        if (typeof spawnNPCs !== 'function') { _print('err', 'spawnNPCs 函式不存在'); return; }
        if (typeof _npcs === 'undefined') { _print('err', '_npcs 未定義'); return; }
        _npcs.length = 0;
        spawnNPCs(gl);
        _print('ok', '已重新生成怪物，目前數量：' + _npcs.length);
    }

    // ── ambient ──────────────────────────────────────────────────────
    function _cmdAmbient(parts) {
        var r = parseFloat(parts[1]);
        var g = parseFloat(parts[2]);
        var b = parseFloat(parts[3]);
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            _print('warn', '用法：ambient <r> <g> <b>  （0~1 浮點數）');
            return;
        }
        if (typeof _sharedLight !== 'undefined') {
            _sharedLight.ambientColor = [r, g, b];
            _print('ok', '環境光 → [' + r + ', ' + g + ', ' + b + ']');
        } else {
            _print('err', '_sharedLight 未定義');
        }
    }

    // ── flashlight ───────────────────────────────────────────────────
    function _cmdFlashlight(parts) {
        if (typeof Flashlight === 'undefined') {
            _print('err', 'Flashlight 模組未載入');
            return;
        }
        var sub = (parts[1] || 'toggle').toLowerCase();
        if (typeof Flashlight.toggle === 'function') {
            Flashlight.toggle();
            _print('ok', '手電筒已切換');
        } else if (typeof Flashlight.setEnabled === 'function') {
            var en = sub === 'off' ? false : sub === 'on' ? true : null;
            if (en === null) { Flashlight.setEnabled(!Flashlight.isEnabled()); }
            else { Flashlight.setEnabled(en); }
            _print('ok', '手電筒 → ' + (sub));
        } else {
            _print('warn', 'Flashlight 模組無 toggle / setEnabled 方法');
        }
    }

    // ── speed ────────────────────────────────────────────────────────
    function _cmdSpeed(parts) {
        var v = parseFloat(parts[1]);
        if (isNaN(v)) { _print('warn', '用法：speed <倍率>  （例：speed 2）'); return; }
        if (typeof Move === 'undefined') { _print('err', 'Move 未載入'); return; }
        var BASE_NORMAL = 0.05;
        var BASE_SPRINT = 0.1;
        Move.setSpeed(BASE_NORMAL * v);
        Move.setSprint(BASE_SPRINT * v);
        _print('ok', '移動速度倍率 → ' + v + 'x');
    }

    // ── noclip ───────────────────────────────────────────────────────
    function _cmdNoclip() {
        _print('warn', 'NoClip 需直接改 Physics 模組，此版本尚未支援');
        _print('info', '替代方案：使用 tp <x> <y> <z> 穿越牆壁');
    }

    // ── list ─────────────────────────────────────────────────────────
    function _cmdList() {
        _print('head', '── 常用全域變數 ──');
        var vars = [
            'piece', 'onSkinstealer', 'onBackteria', 'onPartygeor', 'onSmiler',
            'DEAD_EYE_Y',
        ];
        for (var i = 0; i < vars.length; i++) {
            var v = window[vars[i]];
            _print('sub', vars[i] + ' = ' + JSON.stringify(v));
        }
        _print('head', '── NPC_DEFAULTS 子類型 ──');
        if (typeof NPC_DEFAULTS !== 'undefined') {
            for (var k in NPC_DEFAULTS) {
                _print('sub', k + '.speed=' + NPC_DEFAULTS[k].speed +
                    '  .chaseSpeed=' + NPC_DEFAULTS[k].chaseSpeed +
                    '  .chaseDist=' + NPC_DEFAULTS[k].chaseDist);
            }
        }
        if (typeof _npcs !== 'undefined') {
            _print('head', '── 場上怪物 ──');
            _print('sub', '目前怪物數：' + _npcs.length);
        }
    }

    // ── eval ─────────────────────────────────────────────────────────
    function _cmdEval(code) {
        if (window._settingEvalEnabled === false) {
            _print('err', '⛔ Eval 指令已被管理員停用');
            return;
        }
        if (!code) { _print('warn', '用法：eval <JS 表達式>'); return; }
        try {
            // eslint-disable-next-line no-eval
            var result = eval(code);
            _print('ok', '→ ' + JSON.stringify(result));
        } catch (e) {
            _print('err', e.message);
        }
    }

    // ================================================================
    //  工具
    // ================================================================
    function _pad(str, len) {
        str = String(str);
        while (str.length < len) str += ' ';
        return str;
    }

    function _f(v) {
        return typeof v === 'number' ? v.toFixed(1) : v;
    }

    // ================================================================
    //  Public API
    // ================================================================
    return {
        init: init,
        reset: reset,
        open: _openPanel,
        close: _close,
        toggle: _toggle,
        exec: _execute,   // 允許外部直接執行指令
        print: _print,     // 允許外部輸出到控制台
        setEnabled: function (v) {
            if (!v && _open) _close();
        },
    };

})();