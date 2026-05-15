// ================================================================
//  paper.js — 地圖中的紙張渲染系統
//  依賴: cuon-matrix.js (Matrix4), move.js (Move), stage.js (Stage)
//  在 main.js 的 loop() 中每幀呼叫 Paper.render(projMat, viewMat, light)
//  在 main.js 的 main() 中呼叫 Paper.init(gl)
// ================================================================

// ================================================================
//  ★★★  全域調整區（改這裡就夠了）  ★★★
// ================================================================

// ── 紙張尺寸 ────────────────────────────────────────────────────
var PAPER_WIDTH  = 1.0;    // 紙張寬度（世界單位）
var PAPER_HEIGHT = 1.2;    // 紙張高度（世界單位）

// ── 文字大小比例（相對於紙張高度，0.0~1.0） ─────────────────────
var PAPER_FONT_SCALE = 0.6;

// ── 紙張旋轉說明（三軸，順序：先 X → 再 Y → 再 Z） ────────────
//
//  rotX : 繞 X 軸旋轉（度數）
//         0   = 直立（預設）
//         90  = 平躺朝上（放在地板上）
//        -90  = 平躺朝下（貼天花板）
//
//  rotY : 繞 Y 軸旋轉（度數）
//         0   = 正面朝 +Z 方向
//         90  = 正面朝 +X 方向（朝右）
//         180 = 正面朝 -Z 方向
//         270 = 正面朝 -X 方向（朝左）
//
//  rotZ : 繞 Z 軸旋轉（度數）
//         0   = 正常直立
//         90  = 向右傾倒 90°
//        -15  = 輕微右傾（散落感）
//
//  三軸都可以省略不填，預設值均為 0。
//
//  常用組合範例：
//    直立貼牆朝玩家    → rotX:0,   rotY:0,   rotZ:0
//    直立但稍微傾斜    → rotX:0,   rotY:0,   rotZ:-15
//    平放在地板        → rotX:90,  rotY:0,   rotZ:0
//    斜靠在牆角        → rotX:70,  rotY:45,  rotZ:10
//    貼在天花板朝下    → rotX:-90, rotY:0,   rotZ:0

// ── 紙張清單 ─────────────────────────────────────────────────────
//  type    : 'letter' (字母紙) 或 'number' (數字紙)
//  x/y/z   : 世界座標
//  rotX    : X 軸旋轉角度（度數，可省略，預設 0）
//  rotY    : Y 軸旋轉角度（度數，可省略，預設 0）
//  rotZ    : Z 軸旋轉角度（度數，可省略，預設 0）
//  color   : 文字顏色（'red' / 'yellow' / 'blue' / 'green' / 'white'）
//  content : 字母紙可自訂字母，不填則自動隨機大寫英文字母
//            數字紙填 '1'~'5'，不填則自動從剩餘數字補齊（不重複）
// ================================================================
var PAPER_LIST = [

    // ── 字母紙（5 張，顏色各異，content 不填 → 自動隨機英文字母） ─
    // 直立貼牆，正面朝 +Z
    { type: 'letter', x:  -52.7, y: 1.5, z: 15.0,
      rotX:   180, rotY:   90, rotZ:  180, color: 'red'    },
    // 直立貼牆，正面朝 +X（右側牆）
    { type: 'letter', x: 35.0, y: 0.02, z:  7.0,
      rotX:   90, rotY:  30, rotZ:   0, color: 'yellow' },
    // 直立但略微傾斜（散落感）
    { type: 'letter', x: 57.5, y: 0.02, z: -13.0,
      rotX:   90, rotY: 60, rotZ: 0, color: 'blue'   },
    // 平放在地板上
    { type: 'letter', x: 6.6, y: 5.3, z: -2.0,
      rotX:  -90, rotY:  0, rotZ:   -60, color: 'green'  },
    // 斜靠在角落
    { type: 'letter', x: 39.8, y: 0.3, z: -40.5,
      rotX:  225, rotY:  45, rotZ:  180, color: 'black'  },

    // ── 數字紙（5 張，顏色各異，content 1~5 不可重複） ───────────
    { type: 'number', x: 11.0, y: 1.5, z:  14.5,
      rotX:   180, rotY:   0, rotZ:   180, color: 'red',    content: '1' },
    { type: 'number', x: -41.4, y: 1.5, z: 35.0,
      rotX:   0, rotY:  90, rotZ:   0, color: 'yellow', content: '2' },
    // 平放在地上、稍微旋轉
    { type: 'number', x: 53.4, y: 3, z: 26.2,
      rotX:  0, rotY:  90, rotZ:   30, color: 'blue',   content: '3' },
    { type: 'number', x: -5.8, y: 5.3, z: 23.6,
      rotX:   90, rotY: 0, rotZ:   240, color: 'green',  content: '4' },
    // 貼天花板（假設天花板 y ≈ 5）
    { type: 'number', x: 31.0, y: 2.5, z: 2.7,
      rotX: 180, rotY:   90, rotZ:   160, color: 'black',  content: '5' },

];

// ================================================================
//  ↓↓↓  以下不需要改動  ↓↓↓
// ================================================================
 
var Paper = (function () {
 
    // ── 顏色對照表 ───────────────────────────────────────────────
    var COLOR_MAP = {
        red:    [1.0, 0.08, 0.08],
        yellow: [1.0, 0.92, 0.05],
        blue:   [0.1,  0.3,  1.0],
        green:  [0.1,  0.8,  0.2],
        white:  [1.0,  1.0,  1.0],
        black:  [0.08, 0.08, 0.08],
    };
 
    // ── Shader ──────────────────────────────────────────────────
    var VSHADER = `
        attribute vec3 a_Position;
        attribute vec2 a_TexCoord;
        uniform mat4 u_MvpMatrix;
        uniform mat4 u_ModelMatrix;
        varying vec2 v_TexCoord;
        varying vec3 v_WorldPos;
        void main() {
            gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);
            v_WorldPos  = (u_ModelMatrix * vec4(a_Position, 1.0)).xyz;
            v_TexCoord  = a_TexCoord;
        }`;
 
    var FSHADER = `
        precision mediump float;
        varying vec2 v_TexCoord;
        varying vec3 v_WorldPos;
        uniform sampler2D u_Sampler;
        uniform vec3 u_EyePos;
        uniform vec3 u_AmbientColor;
        uniform vec3 u_LightColor;
 
        // Spotlight（手電筒）
        uniform bool  u_SpotOn;
        uniform vec3  u_SpotPos;
        uniform vec3  u_SpotDir;
        uniform float u_SpotCosAngle;
        uniform float u_SpotRange;
        uniform float u_SpotIntensity;
 
        void main() {
            vec4 texColor = texture2D(u_Sampler, v_TexCoord);
            if (texColor.a < 0.05) discard;
 
            // 簡單環境光 + 平行光照亮紙面（調低亮度，與場景融合）
            vec3 col = texColor.rgb * (u_AmbientColor * 0.25 + u_LightColor * 0.05);
 
            // Spotlight 加光
            if (u_SpotOn) {
                vec3  toFrag = v_WorldPos - u_SpotPos;
                float dist   = length(toFrag);
                if (dist > 0.0 && dist < u_SpotRange) {
                    vec3  fragDir = toFrag / dist;
                    float cosA    = dot(fragDir, u_SpotDir);
                    if (cosA > u_SpotCosAngle) {
                        float atten = clamp(1.0 - (dist*dist)/(u_SpotRange*u_SpotRange), 0.0, 1.0);
                        float spot  = pow((cosA - u_SpotCosAngle)/(1.0 - u_SpotCosAngle), 2.0);
                        float w     = clamp(atten * spot, 0.0, 1.0);
                        vec3 litBase = max(texColor.rgb, vec3(0.18, 0.15, 0.08));
                        vec3 spotCol = litBase * u_SpotIntensity * vec3(1.0, 0.92, 0.72);
                        col = mix(col, max(col, spotCol), w);
                    }
                }
            }
 
            gl_FragColor = vec4(col, texColor.a);
        }`;
 
    // ── 內部狀態 ─────────────────────────────────────────────────
    var _gl      = null;
    var _prog    = null;
    var _loc     = {};
    var _papers  = [];   // 每張紙的 GPU buffer 與狀態
 
    // ================================================================
    //  _compile / _buildProgram
    // ================================================================
    function _compile(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error('[Paper shader] ' + gl.getShaderInfoLog(s));
        return s;
    }
 
    function _buildProg(gl) {
        var p = gl.createProgram();
        gl.attachShader(p, _compile(gl, gl.VERTEX_SHADER,   VSHADER));
        gl.attachShader(p, _compile(gl, gl.FRAGMENT_SHADER, FSHADER));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error('[Paper program] ' + gl.getProgramInfoLog(p));
        return p;
    }
 
    // ================================================================
    //  _makeTexture — 用 Canvas 2D 繪製紙張貼圖
    //    content : 要顯示的文字（單個字母或數字）
    //    color   : 文字顏色名稱
    // ================================================================
    function _makeTexture(gl, content, colorName) {
        var TEX_W = 256, TEX_H = 340;
        var c = document.createElement('canvas');
        c.width  = TEX_W;
        c.height = TEX_H;
        var ctx = c.getContext('2d');
 
        // 紙張底色（略帶米白）
        ctx.fillStyle = '#f5f0e0';
        ctx.fillRect(0, 0, TEX_W, TEX_H);
 
        // 輕微紙張紋理線條（橫線）
        ctx.strokeStyle = 'rgba(180,170,140,0.4)';
        ctx.lineWidth = 1;
        for (var ly = 40; ly < TEX_H; ly += 28) {
            ctx.beginPath();
            ctx.moveTo(20, ly);
            ctx.lineTo(TEX_W - 20, ly);
            ctx.stroke();
        }
 
        // 左側紅色裝訂線
        ctx.strokeStyle = 'rgba(200,80,80,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(48, 0);
        ctx.lineTo(48, TEX_H);
        ctx.stroke();
 
        // 文字顏色
        var rgb = COLOR_MAP[colorName] || COLOR_MAP['white'];
        var r = Math.round(rgb[0] * 255);
        var g = Math.round(rgb[1] * 255);
        var b = Math.round(rgb[2] * 255);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
 
        // 文字
        var fontSize = Math.round(TEX_H * PAPER_FONT_SCALE);
        ctx.font = 'bold ' + fontSize + 'px "Arial Black", Arial, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
 
        // 白色文字加黑邊讓深色底也清晰（只在 white 以外加描邊）
        if (colorName !== 'white') {
            ctx.shadowColor   = 'rgba(0,0,0,0.55)';
            ctx.shadowBlur    = 6;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;
        }
 
        ctx.fillText(content, TEX_W / 2, TEX_H / 2);
 
        // 重設 shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur  = 0;
 
        // 上傳 WebGL 貼圖
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return tex;
    }
 
    // ================================================================
    //  _makePaperMesh — 建立平面四邊形（兩個三角形）
    //    以紙張中心為原點，XY 平面，Z 朝向鏡頭
    // ================================================================
    function _makePaperMesh(gl) {
        var hw = PAPER_WIDTH  / 2;
        var hh = PAPER_HEIGHT / 2;
 
        //  頂點座標（XY 平面，法線朝 +Z）
        //  左下, 右下, 右上, 左上
        var pos = new Float32Array([
            -hw, -hh, 0,
             hw, -hh, 0,
             hw,  hh, 0,
            -hw,  hh, 0,
        ]);
 
        var uv = new Float32Array([
            0, 1,
            1, 1,
            1, 0,
            0, 0,
        ]);
 
        // 兩個三角形（逆時針，正面朝 +Z）
        var idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
 
        var bufPos = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
 
        var bufUV = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bufUV);
        gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
 
        var bufIdx = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
 
        return { bufPos: bufPos, bufUV: bufUV, bufIdx: bufIdx, count: 6 };
    }
 
    // ================================================================
    //  _randomLetter — 回傳隨機大寫英文字母
    // ================================================================
    function _randomLetter() {
        return String.fromCharCode(65 + Math.floor(Math.random() * 26));
    }
 
    // ================================================================
    //  _autoAssignNumbers — 確保 5 張數字紙 content = 1~5 不重複
    //  若使用者已在 PAPER_LIST 填了 content，則尊重原設定
    //  未填的自動從剩餘數字補齊
    // ================================================================
    function _autoAssignNumbers(paperList) {
        var numberPapers = paperList.filter(function (p) { return p.type === 'number'; });
        var used = {};
        numberPapers.forEach(function (p) { if (p.content) used[p.content] = true; });
 
        var remaining = [];
        for (var n = 1; n <= 5; n++) {
            if (!used[String(n)]) remaining.push(String(n));
        }
        // 洗牌
        for (var i = remaining.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = remaining[i]; remaining[i] = remaining[j]; remaining[j] = tmp;
        }
 
        var ri = 0;
        numberPapers.forEach(function (p) {
            if (!p.content && ri < remaining.length) {
                p.content = remaining[ri++];
            }
        });
    }
 
 
    // ================================================================
    //  _shuffleColors — 隨機打亂字母紙與數字紙的顏色配對
    //  確保同順位的字母紙和數字紙拿到相同顏色，但整組配對每次不同
    // ================================================================
    function _shuffleColors(paperList) {
        var letterPapers = paperList.filter(function (p) { return p.type === 'letter'; });
        var numberPapers = paperList.filter(function (p) { return p.type === 'number'; });
        var count = Math.min(letterPapers.length, numberPapers.length, 5);
 
        // 收集字母紙目前的顏色清單
        var colors = letterPapers.slice(0, count).map(function (p) { return p.color; });
 
        // Fisher-Yates 洗牌
        for (var i = colors.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = colors[i]; colors[i] = colors[j]; colors[j] = tmp;
        }
 
        // 重新指派：字母紙[k] 與 數字紙[k] 拿到同一個隨機顏色
        for (var k = 0; k < count; k++) {
            letterPapers[k].color = colors[k];
            numberPapers[k].color = colors[k];
        }

        // ★ 同時打亂數字紙的 content（1~5），讓「哪個數字配哪個顏色」也隨機
        var contents = numberPapers.slice(0, count).map(function (p) { return p.content; });
        for (var ii = contents.length - 1; ii > 0; ii--) {
            var jj = Math.floor(Math.random() * (ii + 1));
            var tc = contents[ii]; contents[ii] = contents[jj]; contents[jj] = tc;
        }
        for (var kk = 0; kk < count; kk++) {
            numberPapers[kk].content = contents[kk];
        }
    }
 
    // ================================================================
    //  init — 在 main() 裡呼叫一次
    // ================================================================
    function init(glCtx) {
        _gl   = glCtx;

        // ★ 重啟修正：刪除舊的 WebGL shader program，避免每次重啟都累積洩漏
        if (_prog) {
            _gl.deleteProgram(_prog);
            _prog = null;
        }

        // ★ 重啟修正：釋放舊紙張的 WebGL buffer / texture
        if (_papers.length > 0) {
            var oldMesh = _papers[0] ? _papers[0].mesh : null;
            if (oldMesh) {
                _gl.deleteBuffer(oldMesh.bufPos);
                _gl.deleteBuffer(oldMesh.bufUV);
                _gl.deleteBuffer(oldMesh.bufIdx);
            }
            _papers.forEach(function (p) {
                if (p.tex) _gl.deleteTexture(p.tex);
            });
            _papers = [];
        }

        _prog = _buildProg(_gl);
 
        // 快取 uniform / attribute 位置
        _loc.a_Position    = _gl.getAttribLocation (_prog, 'a_Position');
        _loc.a_TexCoord    = _gl.getAttribLocation (_prog, 'a_TexCoord');
        _loc.u_MvpMatrix   = _gl.getUniformLocation(_prog, 'u_MvpMatrix');
        _loc.u_ModelMatrix = _gl.getUniformLocation(_prog, 'u_ModelMatrix');
        _loc.u_Sampler     = _gl.getUniformLocation(_prog, 'u_Sampler');
        _loc.u_EyePos        = _gl.getUniformLocation(_prog, 'u_EyePos');
        _loc.u_AmbientColor  = _gl.getUniformLocation(_prog, 'u_AmbientColor');
        _loc.u_LightColor    = _gl.getUniformLocation(_prog, 'u_LightColor');
        _loc.u_SpotOn        = _gl.getUniformLocation(_prog, 'u_SpotOn');
        _loc.u_SpotPos       = _gl.getUniformLocation(_prog, 'u_SpotPos');
        _loc.u_SpotDir       = _gl.getUniformLocation(_prog, 'u_SpotDir');
        _loc.u_SpotCosAngle  = _gl.getUniformLocation(_prog, 'u_SpotCosAngle');
        _loc.u_SpotRange     = _gl.getUniformLocation(_prog, 'u_SpotRange');
        _loc.u_SpotIntensity = _gl.getUniformLocation(_prog, 'u_SpotIntensity');
 
        // 隨機打亂顏色配對（每次遊戲不同）
        _shuffleColors(PAPER_LIST);
 
        // 處理數字紙自動補齊
        _autoAssignNumbers(PAPER_LIST);
 
        // 共用 mesh（所有紙張形狀相同）
        var mesh = _makePaperMesh(_gl);
 
        // 建立各張紙的貼圖與狀態
        _papers = [];
        for (var i = 0; i < PAPER_LIST.length; i++) {
            var cfg = PAPER_LIST[i];
 
            // 字母紙：若無 content 則隨機
            var content = cfg.content;
            if (!content) {
                content = (cfg.type === 'letter') ? _randomLetter() : '?';
            }
 
            var tex = _makeTexture(_gl, content, cfg.color || 'white');
 
            _papers.push({
                mesh   : mesh,
                tex    : tex,
                x      : cfg.x    !== undefined ? cfg.x    : 0,
                y      : cfg.y    !== undefined ? cfg.y    : 1.5,
                z      : cfg.z    !== undefined ? cfg.z    : 0,
                rotX   : cfg.rotX !== undefined ? cfg.rotX : 0,
                rotY   : cfg.rotY !== undefined ? cfg.rotY : 0,
                rotZ   : cfg.rotZ !== undefined ? cfg.rotZ : 0,
                content: content,
                color  : cfg.color || 'white',
                type   : cfg.type,
            });
        }
 
        console.log('[Paper] 初始化完成，紙張數量:', _papers.length);
    }
 
    // ================================================================
    //  render — 每幀由 main.js loop() 呼叫
    //    projMat  : Matrix4 投影矩陣
    //    viewMat  : Matrix4 視圖矩陣（由 _buildViewMat 產生）
    //    light    : _sharedLight { eyePos, ambientColor, lightColor }
    // ================================================================
    function render(projMat, viewMat, light) {
        if (!_gl || !_prog || _papers.length === 0) return;
 
        var gl = _gl;
        gl.useProgram(_prog);
 
        // 開啟透明度混合（用於邊緣 alpha）
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
 
        // 傳入光影 uniform
        gl.uniform3fv(_loc.u_EyePos,       light.eyePos);
        gl.uniform3fv(_loc.u_AmbientColor,  light.ambientColor);
        gl.uniform3fv(_loc.u_LightColor,    light.lightColor);
 
        // Spotlight（手電筒）
        if (typeof Flashlight !== 'undefined') {
            var _spot = Flashlight.getSpotUniforms();
            gl.uniform1i(_loc.u_SpotOn, _spot.held ? 1 : 0);
            if (_spot.held) {
                gl.uniform3fv(_loc.u_SpotPos,      _spot.spotPos);
                gl.uniform3fv(_loc.u_SpotDir,      _spot.spotDir);
                gl.uniform1f(_loc.u_SpotCosAngle,  _spot.spotCosOuter);
                gl.uniform1f(_loc.u_SpotRange,     _spot.spotRange);
                gl.uniform1f(_loc.u_SpotIntensity, _spot.spotIntensity);
            }
        } else {
            gl.uniform1i(_loc.u_SpotOn, 0);
        }
 
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(_loc.u_Sampler, 0);
 
        for (var i = 0; i < _papers.length; i++) {
            var p = _papers[i];
            var m = p.mesh;
 
            // ── 建立 Model Matrix（平移 → X旋轉 → Y旋轉 → Z旋轉）──
            //    旋轉順序：先 rotX（前後仰）→ rotY（左右朝向）→ rotZ（傾斜）
            var modelMat = new Matrix4();
            modelMat.setTranslate(p.x, p.y, p.z);
            if (p.rotY !== 0) modelMat.rotate(p.rotY, 0, 1, 0);
            if (p.rotX !== 0) modelMat.rotate(p.rotX, 1, 0, 0);
            if (p.rotZ !== 0) modelMat.rotate(p.rotZ, 0, 0, 1);
 
            var mvp = new Matrix4(projMat);
            mvp.multiply(viewMat);
            mvp.multiply(modelMat);
 
            gl.uniformMatrix4fv(_loc.u_MvpMatrix,   false, mvp.elements);
            gl.uniformMatrix4fv(_loc.u_ModelMatrix,  false, modelMat.elements);
 
            // ── 綁定 Buffer ────────────────────────────────────────
            gl.bindBuffer(gl.ARRAY_BUFFER, m.bufPos);
            gl.enableVertexAttribArray(_loc.a_Position);
            gl.vertexAttribPointer(_loc.a_Position, 3, gl.FLOAT, false, 0, 0);
 
            gl.bindBuffer(gl.ARRAY_BUFFER, m.bufUV);
            gl.enableVertexAttribArray(_loc.a_TexCoord);
            gl.vertexAttribPointer(_loc.a_TexCoord, 2, gl.FLOAT, false, 0, 0);
 
            // ── 貼圖 ───────────────────────────────────────────────
            gl.bindTexture(gl.TEXTURE_2D, p.tex);
 
            // ── 繪製（雙面：正面 + 背面各畫一次） ────────────────
            // 正面
            gl.disable(gl.CULL_FACE);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.bufIdx);
            gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
        }
 
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
    }
 
    // ================================================================
    //  Public API
    // ================================================================
    return {
        init      : init,
        render    : render,
        getPapers : function () { return _papers; },
        getColorMap: function () { return COLOR_MAP; },
    };
 
})();