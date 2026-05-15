// ================================================================
//  input-lock.js — 全域鍵盤輸入鎖
//
//  任何 UI（Victor 終端機、紙張預覽、Instruction 控制台）
//  開啟時呼叫 InputLock.claim(id)，
//  關閉時呼叫 InputLock.release(id)。
//
//  只要有任何一個 claim 存在，
//  document 的 keydown / keyup / keypress 就會在
//  capture 階段被攔截，遊戲邏輯（move.js 等）完全收不到。
//
//  使用方式：
//    InputLock.claim('victor-terminal');
//    InputLock.release('victor-terminal');
//    InputLock.isLocked();   // → true / false
// ================================================================

var InputLock = (function () {

    // 目前持有鎖的 ID 集合
    var _owners = {};

    // ── capture-phase 攔截器 ─────────────────────────────────────
    // 注意：用 capture=true，在所有 bubble listener 之前執行
    function _capture(e) {
        if (!isLocked()) return;

        // ── instruction 控制台持有鎖時，完整放行所有按鍵給它 ──────
        // instruction 的 listener 也掛在 capture 階段（見下方說明），
        // 所以這裡只需要不 stopPropagation 即可讓它收到。
        // 但其他遊戲邏輯（move.js 等）掛在 bubble 階段，
        // 我們在這裡 stopPropagation 就能阻止遊戲收到。
        if (_owners['instruction']) {
            // 放行所有鍵給 instruction，但仍阻止 bubble 到遊戲
            e.stopPropagation();
            return;
        }

        // ── 其他 UI（Victor 終端機等）持有鎖時 ────────────────────
        if (e.key === 'Escape') return;   // Escape 放行
        if (e.key === 'Enter')  return;   // Enter 放行

        // 吃掉其他按鍵
        e.stopPropagation();
    }

    // 綁定一次即可
    document.addEventListener('keydown',  _capture, true);
    document.addEventListener('keyup',    _capture, true);
    document.addEventListener('keypress', _capture, true);

    // ================================================================
    //  Public API
    // ================================================================

    /** 聲明鍵盤使用權 */
    function claim(id) {
        _owners[id] = true;
    }

    /** 釋放鍵盤使用權 */
    function release(id) {
        delete _owners[id];
    }

    /** 釋放所有鎖（緊急用途） */
    function releaseAll() {
        _owners = {};
    }

    /** 是否目前有任何 UI 持有鎖 */
    function isLocked() {
        for (var k in _owners) {
            if (_owners.hasOwnProperty(k)) return true;
        }
        return false;
    }

    /** 列出目前所有持有鎖的 ID（除錯用） */
    function owners() {
        return Object.keys(_owners);
    }

    return { claim, release, releaseAll, isLocked, owners };

})();