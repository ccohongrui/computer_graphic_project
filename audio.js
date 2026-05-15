// ================================================================
//  audio.js — 集中音效管理系統
//
//  音效規則：
//    prepare.mp3  — 主選單背景（循環）
//    day.mp3      — 白天背景（循環）
//    night.mp3    — 夜晚背景（循環）
//    chase.mp3    — 被追擊時（循環），停止背景音效
//    kill.mp3     — 死亡時（不循環），停止背景音效
//    noise.mp3    — 勝利結算動畫（不循環），停止背景音效
//
//  狀態機（優先級由高到低）：
//    DEAD   > CHASE  > WIN  > DAY/NIGHT  > MENU
//
//  暫停行為：
//    暫停時全部靜音（實際 pause，保留播放位置）
//    繼續時依當前遊戲狀態決定恢復哪條音效
//
//  退出至主選單：
//    停止所有遊戲音效，切換回 prepare.mp3
// ================================================================

var AudioManager = (function () {

    // ── 所有音效節點 ─────────────────────────────────────────────
    var _tracks = {};           // key → HTMLAudioElement
    var _keys   = ['prepare', 'day', 'night', 'chase', 'kill', 'noise'];

    // ── 當前狀態 ─────────────────────────────────────────────────
    // 'menu' | 'day' | 'night' | 'chase' | 'dead' | 'win'
    var _state      = 'menu';
    var _paused     = false;
    var _gameActive = false;    // 遊戲 loop 是否進行中

    // 上一次的日夜狀態（用來偵測切換）
    var _lastNight  = false;

    // chase 偵測 debounce（任一 NPC 追擊中 → chase mode）
    var _chaseActive  = false;

    // ── 初始化 ───────────────────────────────────────────────────
    function init() {
        _keys.forEach(function (k) {
            var a = new Audio(k + '.mp3');
            a.preload = 'auto';
            a.loop    = false;  // 個別在播放時設定
            a.volume  = 1.0;
            _tracks[k] = a;
        });

        // 循環設定
        _tracks['prepare'].loop = true;
        _tracks['day'].loop     = true;
        _tracks['night'].loop   = true;
        _tracks['chase'].loop   = true;

        console.log('[Audio] 初始化完成');
    }

    // ── 停止所有音效 ─────────────────────────────────────────────
    function _stopAll() {
        _keys.forEach(function (k) {
            var a = _tracks[k];
            if (!a) return;
            a.pause();
            a.currentTime = 0;
        });
    }

    // ── 停止背景音效（day/night） ─────────────────────────────────
    function _stopBg() {
        ['day', 'night'].forEach(function (k) {
            var a = _tracks[k];
            if (!a) return;
            a.pause();
            a.currentTime = 0;
        });
    }

    // ── 播放某個 track（若已在播放則不重啟）─────────────────────
    function _play(key, restart) {
        var a = _tracks[key];
        if (!a) return;
        if (restart) {
            a.currentTime = 0;
        }
        if (a.paused) {
            a.play().catch(function (e) {
                console.warn('[Audio] 無法播放 ' + key + ':', e.message);
            });
        }
    }

    // ── 停止某個 track ────────────────────────────────────────────
    function _stop(key) {
        var a = _tracks[key];
        if (!a) return;
        a.pause();
        a.currentTime = 0;
    }

    // ================================================================
    //  公開 API
    // ================================================================

    // 主選單啟動時呼叫
    function playMenu() {
        if (_paused) return;
        _gameActive = false;
        _state      = 'menu';
        _stopAll();
        _play('prepare', true);
        console.log('[Audio] 主選單 → prepare.mp3');
    }

    // 遊戲開始（從主選單進入）
    function onGameStart() {
        _gameActive   = true;
        _paused       = false;
        _chaseActive  = false;
        _state        = 'day';
        _lastNight    = false;
        _stop('prepare');
        _play('day', true);
        console.log('[Audio] 遊戲開始 → day.mp3');
    }

    // 每幀由 main.js loop() 呼叫（僅在遊戲正常進行時）
    // isNight  : boolean（Stage.isNight() 的值）
    // npcs     : NPC 陣列
    function update(isNight, npcs) {
        if (!_gameActive || _paused) return;
        // dead / win 狀態由專屬函式接管，不在這裡更新
        if (_state === 'dead' || _state === 'win') return;

        // 偵測是否有任何 NPC 正在追擊玩家
        var anyChasing = false;
        if (npcs && !window.piece) {
            for (var i = 0; i < npcs.length; i++) {
                if (npcs[i] && typeof npcs[i]._isChasing === 'function' && npcs[i]._isChasing()) {
                    anyChasing = true;
                    break;
                }
                // 透過公開旗標 isChasing（見 npc.js 修改版）
                if (npcs[i] && npcs[i].isChasing && npcs[i].isChasing()) {
                    anyChasing = true;
                    break;
                }
            }
        }

        // ── 追擊狀態切換 ─────────────────────────────────────────
        if (anyChasing && !_chaseActive) {
            _chaseActive = true;
            _state       = 'chase';
            _stopBg();
            _play('chase', true);
            console.log('[Audio] 追擊開始 → chase.mp3');
            return;
        }
        if (!anyChasing && _chaseActive) {
            _chaseActive = false;
            // 恢復背景音效
            _stop('chase');
            _state = isNight ? 'night' : 'day';
            _play(_state, true);
            console.log('[Audio] 追擊結束 → ' + _state + '.mp3');
            return;
        }

        // 追擊中：不做日夜切換
        if (_chaseActive) return;

        // ── 日夜切換 ─────────────────────────────────────────────
        if (isNight !== _lastNight) {
            _lastNight = isNight;
            _state     = isNight ? 'night' : 'day';
            _stop(isNight ? 'day' : 'night');
            _play(_state, true);
            console.log('[Audio] 日夜切換 → ' + _state + '.mp3');
        }
    }

    // 死亡時呼叫（kill.mp3，不循環）
    function onDead() {
        if (_state === 'dead') return;
        _state = 'dead';
        _chaseActive = false;
        _stopAll();
        _play('kill', true);
        console.log('[Audio] 死亡 → kill.mp3');
    }

    // 死亡動畫結束，重生後呼叫（由 dead.js _finish 觸發）
    function onRespawn() {
        _chaseActive = false;
        _lastNight   = false;

        // 先強制停止 kill.mp3（可能還在播）
        _stop('kill');

        if (!_gameActive || _paused) return;

        // 延遲 80ms 再播，避免與 kill.mp3 的 pause() 產生 promise 衝突
        // 導致瀏覽器拒絕 autoplay
        setTimeout(function () {
            if (!_gameActive || _paused) return;
            var isNight = (typeof Stage !== 'undefined') ? Stage.isNight() : false;
            _state = isNight ? 'night' : 'day';
            _stop('day');
            _stop('night');
            _play(_state, true);
            console.log('[Audio] 重生 → ' + _state + '.mp3');
        }, 80);
    }

    // 勝利時呼叫（noise.mp3，不循環）
    function onWin() {
        if (_state === 'win') return;
        _state       = 'win';
        _chaseActive = false;
        _stopAll();
        _play('noise', true);
        console.log('[Audio] 勝利 → noise.mp3');
    }

    // 勝利動畫結束回主選單時呼叫（由 victor.js _returnToMenu 觸發）
    function onReturnToMenu() {
        _gameActive  = false;
        _state       = 'menu';
        _chaseActive = false;
        _stopAll();
        _play('prepare', true);
        console.log('[Audio] 回主選單 → prepare.mp3');
    }

    // 暫停（保留播放位置，靜音）
    function onPause() {
        if (_paused) return;
        _paused = true;
        _keys.forEach(function (k) {
            var a = _tracks[k];
            if (a && !a.paused) a.pause();
        });
        console.log('[Audio] 暫停，所有音效靜音');
    }

    // 繼續（依當前狀態恢復正確音效）
    function onResume() {
        if (!_paused) return;
        _paused = false;
        if (!_gameActive) {
            // 在主選單的暫停（不太可能，但防守）
            _play('prepare');
            return;
        }
        switch (_state) {
            case 'chase': _play('chase'); break;
            case 'dead':  _play('kill');  break;
            case 'win':   _play('noise'); break;
            case 'night': _play('night'); break;
            default:      _play('day');   break;
        }
        console.log('[Audio] 繼續 → ' + _state);
    }

    // 退出至主選單（Quit）
    function onQuit() {
        _gameActive  = false;
        _state       = 'menu';
        _chaseActive = false;
        _stopAll();
        _play('prepare', true);
        console.log('[Audio] 退出 → prepare.mp3');
    }

    // 設定所有音效音量（0.0 ~ 1.0）
    function setVolume(v) {
        v = Math.max(0, Math.min(1, v));
        _keys.forEach(function (k) {
            if (_tracks[k]) _tracks[k].volume = v;
        });
        window._settingVolume = v;
        console.log('[Audio] 音量設為', Math.round(v * 100) + '%');
    }

    // ── 自動初始化 ───────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init          : init,
        playMenu      : playMenu,
        onGameStart   : onGameStart,
        update        : update,
        onDead        : onDead,
        onRespawn     : onRespawn,
        onWin         : onWin,
        onReturnToMenu: onReturnToMenu,
        onPause       : onPause,
        onResume      : onResume,
        onQuit        : onQuit,
        setVolume     : setVolume,
    };

})();