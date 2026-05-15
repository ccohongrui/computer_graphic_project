// ================================================================
//  stage.js — WebGL 地圖載入 & 渲染
//  依賴: cuon-matrix.js (Matrix4), move.js (Move)
// ================================================================

var Stage = (function () {

    var VSHADER_SOURCE = `
        attribute vec3 a_Position;
        attribute vec2 a_TexCoord;
        attribute vec3 a_Normal;

        uniform mat4 u_MvpMatrix;
        uniform mat4 u_ModelMatrix;
        uniform mat4 u_NormalMatrix;

        varying vec2 v_TexCoord;
        varying vec3 v_Normal;
        varying vec3 v_WorldPos;

        void main() {
            gl_Position = u_MvpMatrix * vec4(a_Position, 1.0);
            v_WorldPos  = (u_ModelMatrix * vec4(a_Position, 1.0)).xyz;
            v_Normal    = normalize((u_NormalMatrix * vec4(a_Normal, 0.0)).xyz);
            v_TexCoord  = a_TexCoord;
        }`;

    var FSHADER_SOURCE = `
        precision mediump float;

        varying vec2 v_TexCoord;
        varying vec3 v_Normal;
        varying vec3 v_WorldPos;

        uniform sampler2D u_Sampler;
        uniform bool      u_HasTex;
        uniform vec3      u_BaseColor;
        uniform vec3      u_EmitColor;
        uniform float     u_Shininess;
        uniform vec3      u_EyePos;
        uniform vec3      u_LightPos;
        uniform vec3      u_AmbientColor;
        uniform vec3      u_LightColor;
        uniform vec3      u_SpecularColor;

        // ── Spotlight（手電筒）──────────────────────────────────
        uniform bool  u_SpotOn;
        uniform vec3  u_SpotPos;
        uniform vec3  u_SpotDir;
        uniform float u_SpotCosAngle;
        uniform float u_SpotRange;
        uniform float u_SpotIntensity;

        void main() {
            vec3 baseColor = u_HasTex ? texture2D(u_Sampler, v_TexCoord).rgb : u_BaseColor;
            vec3 eyeDir    = normalize(u_EyePos   - v_WorldPos);
            vec3 lightDir  = normalize(u_LightPos - v_WorldPos);
            vec3 norm      = normalize(v_Normal);
            if (dot(norm, lightDir) < 0.0) norm = -norm;

            vec3 ambient = u_AmbientColor * baseColor;

            float diff   = max(dot(lightDir, norm), 0.0);
            vec3 diffuse = u_LightColor * baseColor * diff;

            vec3  halfDir = normalize(eyeDir + lightDir);
            float spec    = pow(max(dot(halfDir, norm), 0.0), u_Shininess);
            vec3  specular = u_SpecularColor * u_LightColor * spec * 0.015;

            vec3 col = ambient + diffuse + specular + u_EmitColor;

            // ── Spotlight 加光 ──────────────────────────────────
            if (u_SpotOn) {
                vec3  toFrag  = v_WorldPos - u_SpotPos;
                float dist    = length(toFrag);
                if (dist > 0.0 && dist < u_SpotRange) {
                    vec3  fragDir = toFrag / dist;
                    float cosA    = dot(fragDir, u_SpotDir);
                    if (cosA > u_SpotCosAngle) {
                        // 平方衰減
                        float atten = clamp(1.0 - (dist * dist) / (u_SpotRange * u_SpotRange), 0.0, 1.0);
                        // 錐形柔邊
                        float spot  = pow((cosA - u_SpotCosAngle) / (1.0 - u_SpotCosAngle), 2.0);
                        float w     = clamp(atten * spot, 0.0, 1.0);
                        // 法線 diffuse，讓側面/正面仍有立體感，但最低值拉高避免全黑
                        float diff2 = max(dot(-fragDir, norm), 0.35);
                        // spotlight 目標色：baseColor 最低拉到 0.15，純黑也能被照亮
                        vec3 litBase = max(baseColor, vec3(0.18, 0.15, 0.08));
                        vec3 spotCol = litBase * u_SpotIntensity * diff2 * vec3(1.0, 0.92, 0.72);
                        // mix：照到的地方強制顯示 spotCol，原本更亮則保留
                        col = mix(col, max(col, spotCol), w);
                    }
                }
            }

            gl_FragColor = vec4(col, 1.0);
        }`;


    var _isNight = false;
    var _isFlickering = false;
    var _flickerEndTime = 0;
    var _targetNightState = false;
    var _nextNightToggle = 0;

    // ── 內部狀態 ────────────────────────────────────────────────
    var _gl = null;
    var _prog = null;
    var _loc = {};
    var _meshes = [];    // [{ bufPos, bufUV, bufNrm, count, texture, hasTex, baseColor, emitColor, specularColor, shininess }]
    var _groups = [];    // ★ 保留原始幾何群組，供 Physics 建立碰撞體
    var _onLoad = null;  // ★ 地圖載入完成後的回調

    // ★ 地圖整體縮放倍率（放大讓走廊/天花板更寬敞）
    //   原始尺寸：XZ ≈ 62 單位，Y ≈ 3 單位
    //   ×3 後：天花板高 ~9，走廊寬 ~6，玩家眼高 1.7 比例正常
    var MAP_SCALE = 2;

    var MAP_DIR = 'backroom_map/';

    // ── GL 工具 ─────────────────────────────────────────────────
    function _compileShader(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    function _buildProgram(gl, vs, fs) {
        var p = gl.createProgram();
        gl.attachShader(p, _compileShader(gl, gl.VERTEX_SHADER, vs));
        gl.attachShader(p, _compileShader(gl, gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(p));
        return p;
    }

    // ── MTL 解析 ────────────────────────────────────────────────
    function _parseMTL(text) {
        var mats = {}, cur = null;
        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line[0] === '#') return;
            var parts = line.split(/\s+/);
            switch (parts[0]) {
                case 'newmtl': cur = {}; mats[parts[1]] = cur; break;
                case 'Kd': if (cur) cur.Kd = parts.slice(1).map(Number); break;
                case 'Ks': if (cur) cur.Ks = parts.slice(1).map(Number); break;
                case 'Ke': if (cur) cur.Ke = parts.slice(1).map(Number); break;
                case 'Ns': if (cur) cur.Ns = +parts[1]; break;
                case 'map_Kd': if (cur) cur.map_Kd = parts.slice(1).join(' '); break;
            }
        });
        return mats;
    }

    // ── OBJ 解析 ────────────────────────────────────────────────
    function _parseOBJ(text) {
        var posPool = [], uvPool = [], nrmPool = [];
        var groups = [], cur = null;

        function newGroup(name) {
            cur = { matName: name, positions: [], uvs: [], normals: [] };
            groups.push(cur);
        }

        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line || line[0] === '#') return;
            var parts = line.split(/\s+/);
            switch (parts[0]) {
                case 'v':
                    posPool.push(+parts[1], +parts[2], +parts[3]); break;
                case 'vt':
                    uvPool.push(+parts[1], 1.0 - +parts[2]); break;   // flip V
                case 'vn':
                    nrmPool.push(+parts[1], +parts[2], +parts[3]); break;
                case 'usemtl':
                    newGroup(parts[1]); break;
                case 'f': {
                    if (!cur) newGroup('__default__');
                    var verts = parts.slice(1).map(function (s) {
                        var idx = s.split('/').map(function (x) { return parseInt(x) - 1; });
                        return { vi: idx[0], ti: idx[1], ni: idx[2] };
                    });
                    // Fan triangulation
                    for (var i = 1; i < verts.length - 1; i++) {
                        [verts[0], verts[i], verts[i + 1]].forEach(function (v) {
                            cur.positions.push(
                                posPool[v.vi * 3], posPool[v.vi * 3 + 1], posPool[v.vi * 3 + 2]);
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

    // ── 貼圖載入 ────────────────────────────────────────────────
    function _loadTexture(gl, url) {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([200, 180, 140, 255]));   // 暖色佔位

        var img = new Image();
        img.onload = function () {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
            if (aniso) {
                var max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
            }
        };
        img.onerror = function () { console.warn('[Stage] 貼圖找不到:', url); };
        img.src = url;
        return tex;
    }

    // ── XHR 文字載入 ────────────────────────────────────────────
    function _fetchText(url, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = function () { cb(xhr.responseText); };
        xhr.onerror = function () { console.error('[Stage] 載入失敗:', url); };
        xhr.send();
    }

    // ================================================================
    //  init: 建立 GL context、編譯 shader、開始載入地圖
    // ================================================================
    function init(canvas, onLoad) {
        _onLoad = onLoad || null;
        var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { alert('WebGL not supported'); return; }
        _gl = gl;

        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);

        _prog = _buildProgram(gl, VSHADER_SOURCE, FSHADER_SOURCE);
        gl.useProgram(_prog);

        _loc = {
            a_Position: gl.getAttribLocation(_prog, 'a_Position'),
            a_TexCoord: gl.getAttribLocation(_prog, 'a_TexCoord'),
            a_Normal: gl.getAttribLocation(_prog, 'a_Normal'),
            u_MvpMatrix: gl.getUniformLocation(_prog, 'u_MvpMatrix'),
            u_ModelMatrix: gl.getUniformLocation(_prog, 'u_ModelMatrix'),
            u_NormalMatrix: gl.getUniformLocation(_prog, 'u_NormalMatrix'),
            u_Sampler: gl.getUniformLocation(_prog, 'u_Sampler'),
            u_HasTex: gl.getUniformLocation(_prog, 'u_HasTex'),
            u_BaseColor: gl.getUniformLocation(_prog, 'u_BaseColor'),
            u_EmitColor: gl.getUniformLocation(_prog, 'u_EmitColor'),
            u_SpecularColor: gl.getUniformLocation(_prog, 'u_SpecularColor'),
            u_Shininess: gl.getUniformLocation(_prog, 'u_Shininess'),
            u_EyePos: gl.getUniformLocation(_prog, 'u_EyePos'),
            u_LightPos: gl.getUniformLocation(_prog, 'u_LightPos'),
            u_AmbientColor: gl.getUniformLocation(_prog, 'u_AmbientColor'),
            u_LightColor: gl.getUniformLocation(_prog, 'u_LightColor'),
            // Spotlight
            u_SpotOn:       gl.getUniformLocation(_prog, 'u_SpotOn'),
            u_SpotPos:      gl.getUniformLocation(_prog, 'u_SpotPos'),
            u_SpotDir:      gl.getUniformLocation(_prog, 'u_SpotDir'),
            u_SpotCosAngle: gl.getUniformLocation(_prog, 'u_SpotCosAngle'),
            u_SpotRange:    gl.getUniformLocation(_prog, 'u_SpotRange'),
            u_SpotIntensity:gl.getUniformLocation(_prog, 'u_SpotIntensity'),
        };

        // ★ 重啟修正：清空舊的 mesh / group（避免幾何體累積重複渲染）
        _meshes = [];
        _groups = [];

        // ★ 重啟修正：重置日夜與閃爍狀態（不讓上一局的黑夜延續到下一局）
        _isNight        = false;
        _isFlickering   = false;
        _flickerEndTime = 0;
        _targetNightState = false;

        _nextNightToggle = Date.now() + (10000 + Math.random() * 10000);

        _loadMap(gl);
    }

    // ── 載入地圖 ────────────────────────────────────────────────
    function _loadMap(gl) {
        _fetchText(MAP_DIR + 'backrooms.mtl', function (mtlText) {
            var materials = _parseMTL(mtlText);
            var texMap = {};

            // 貼圖預載
            Object.keys(materials).forEach(function (name) {
                var mat = materials[name];
                if (mat.map_Kd)
                    texMap[name] = _loadTexture(gl, MAP_DIR + mat.map_Kd);
            });

            _fetchText(MAP_DIR + 'backrooms.obj', function (objText) {
                var groups = _parseOBJ(objText);

                // ★ 保留群組供 Physics 使用
                _groups = groups;

                groups.forEach(function (g) {
                    if (!g.positions.length) return;
                    var mat = materials[g.matName] || {};

                    var mkBuf = function (data) {
                        var buf = gl.createBuffer();
                        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
                        return buf;
                    };

                    _meshes.push({
                        bufPos: mkBuf(g.positions),
                        bufUV: mkBuf(g.uvs),
                        bufNrm: mkBuf(g.normals),
                        count: g.positions.length / 3,
                        texture: texMap[g.matName] || null,
                        hasTex: !!texMap[g.matName],
                        baseColor: mat.Kd || [0.8, 0.8, 0.8],
                        specularColor: mat.Ks || [0.15, 0.15, 0.15],
                        emitColor: mat.Ke || [0.0, 0.0, 0.0],
                        shininess: mat.Ns !== undefined ? mat.Ns : 32.0,
                    });
                });

                console.log('[Stage] 載入完成，mesh 群組:', _meshes.length);

                // ★ 通知外部（main.js）地圖已就緒，傳入 scale 供 Physics 縮放碰撞體
                if (typeof _onLoad === 'function') _onLoad(_groups, MAP_SCALE);
            });
        });
    }

    // ================================================================
    //  render: 每幀由外部 loop 呼叫
    //    playerPos : { x, y, z }   玩家世界座標
    //    projMat   : Matrix4        投影矩陣
    // ================================================================
    function render(playerPos, projMat) {
        var gl = _gl;
        if (!gl || !_prog) return;

        gl.clearColor(0.04, 0.03, 0.02, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(_prog);

        // ── 視圖矩陣 ──────────────────────────────────────────────
        var theta = Move.getTheta() * Math.PI / 180;
        var phi = Move.getPhi() * Math.PI / 180;

        var sinT = Math.sin(theta), cosT = Math.cos(theta);
        var sinP = Math.sin(phi), cosP = Math.cos(phi);

        // 前向向量
        var fwdX = cosP * sinT;
        var fwdY = sinP;
        var fwdZ = -cosP * cosT;

        // 第一/第三人稱：eye 沿前向反方向退 dist 距離
        var dist = Move.getDist();
        var eyeX = playerPos.x - fwdX * dist;
        var eyeY = playerPos.y - fwdY * dist;
        var eyeZ = playerPos.z - fwdZ * dist;

        // center = 玩家位置方向（第一人稱時 dist=0，與 eye+forward 等效）
        var cX = playerPos.x + fwdX * (1 - dist);
        var cY = playerPos.y + fwdY * (1 - dist);
        var cZ = playerPos.z + fwdZ * (1 - dist);

        // up vector：phi 接近 ±90° 時避免叉積為零
        var upX = 0, upY = 1, upZ = 0;
        if (Math.abs(sinP) > 0.999) {
            upX = -sinT * sinP;
            upY = cosP;
            upZ = cosT * sinP;
        }

        var viewMat = new Matrix4();
        viewMat.setLookAt(
            eyeX, eyeY, eyeZ,
            cX, cY, cZ,
            upX, upY, upZ
        );

        // model = 均勻縮放（地圖整體放大）
        var modelMat = new Matrix4();
        modelMat.setScale(MAP_SCALE, MAP_SCALE, MAP_SCALE);
        var normalMat = new Matrix4();
        normalMat.setInverseOf(modelMat);
        normalMat.transpose();

        var mvpMat = new Matrix4(projMat);
        mvpMat.multiply(viewMat);
        mvpMat.multiply(modelMat);

        gl.uniformMatrix4fv(_loc.u_MvpMatrix, false, mvpMat.elements);
        gl.uniformMatrix4fv(_loc.u_ModelMatrix, false, modelMat.elements);
        gl.uniformMatrix4fv(_loc.u_NormalMatrix, false, normalMat.elements);

        // 螢光燈光源
        gl.uniform3fv(_loc.u_LightPos, [playerPos.x, playerPos.y, playerPos.z]);
        gl.uniform3fv(_loc.u_AmbientColor, [0.38, 0.34, 0.24]);
        gl.uniform3fv(_loc.u_EyePos, [eyeX, eyeY, eyeZ]);

        // =====================================================
        // 隨機閃燈
        // =====================================================
        var now = Date.now();
        // 開始閃爍
        if (!_isFlickering && now >= _nextNightToggle) {
            _isFlickering = true;
            _flickerEndTime = now + 2000;
            _targetNightState = !_isNight;
        }
        // 閃爍結束
        if (_isFlickering && now >= _flickerEndTime) {
            _isFlickering = false;
            // 正式切換日夜
            _isNight = _targetNightState;
            // 下一次切換時間
            _nextNightToggle = now + (20000 + Math.random() * 10000);
            console.log(_isNight ? '[Stage] 天黑了' : '[Stage] 天亮了');
        }

        var lightColor;
        //_isNight = true;

        if (_isFlickering) {
            // 快速亂閃
            if (Math.random() < 0.5)
                lightColor = [0.0, 0.0, 0.0];
            else
                lightColor = [1.0, 0.95, 0.82];
        }
        else if (_isNight) {
            if (Math.random() < 0.99)
                lightColor = [0.0, 0.0, 0.0];
            else
                lightColor = [1.0, 0.95, 0.82];
        }
        else {
            lightColor = [1.0, 0.95, 0.82];
        }

        gl.uniform3fv(_loc.u_LightColor, lightColor);

        // ── Spotlight（手電筒）uniform ─────────────────────────
        if (typeof Flashlight !== 'undefined') {
            var _spot = Flashlight.getSpotUniforms();
            gl.uniform1i(_loc.u_SpotOn, _spot.held ? 1 : 0);
            if (_spot.held) {
                gl.uniform3fv(_loc.u_SpotPos,       _spot.spotPos);
                gl.uniform3fv(_loc.u_SpotDir,       _spot.spotDir);
                gl.uniform1f(_loc.u_SpotCosAngle,   _spot.spotCosOuter);
                gl.uniform1f(_loc.u_SpotRange,      _spot.spotRange);
                gl.uniform1f(_loc.u_SpotIntensity,  _spot.spotIntensity);
            }
        } else {
            gl.uniform1i(_loc.u_SpotOn, 0);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(_loc.u_Sampler, 0);

        _meshes.forEach(function (mesh) {
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bufPos);
            gl.enableVertexAttribArray(_loc.a_Position);
            gl.vertexAttribPointer(_loc.a_Position, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bufUV);
            gl.enableVertexAttribArray(_loc.a_TexCoord);
            gl.vertexAttribPointer(_loc.a_TexCoord, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.bufNrm);
            gl.enableVertexAttribArray(_loc.a_Normal);
            gl.vertexAttribPointer(_loc.a_Normal, 3, gl.FLOAT, false, 0, 0);

            gl.uniform1i(_loc.u_HasTex, mesh.hasTex ? 1 : 0);
            gl.uniform3fv(_loc.u_BaseColor, mesh.baseColor);
            gl.uniform3fv(_loc.u_SpecularColor, mesh.specularColor);
            gl.uniform3fv(_loc.u_EmitColor, mesh.emitColor);
            gl.uniform1f(_loc.u_Shininess, mesh.shininess);

            if (mesh.texture) gl.bindTexture(gl.TEXTURE_2D, mesh.texture);

            gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        });
    }

    // ================================================================
    //  Public API
    // ================================================================
    return {
        init, render,
        getGroups: function () { return _groups; },
        getMapScale: function () { return MAP_SCALE; },
        setMapScale: function (v) { MAP_SCALE = v; },
        setNight: function (v) { _isNight = v; },
        isNight: function () { return _isNight; },
    };

})();