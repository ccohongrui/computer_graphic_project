// ================================================================
//  npc.js — 骨骼蒙皮動畫 + 障礙物迴避 NPC
//  依賴: cuon-matrix.js (Matrix4), stage.js (Stage), physics.js (Physics)
//
//  使用方式（多怪物）：
//    var npc = createNPC({ posX, posY, posZ, scale, runScale });
//    npc.init(gl);
//    // 每幀：
//    npc.update(playerPos);
//    npc.render(playerPos, projMat, viewMat, lightState);
//
//  ── 方向約定 ────────────────────────────────────────────────────
//    _dir = 0   → 面向 +Z，往 +Z 移動
//    _dir = π/2 → 面向 +X，往 +X 移動
//    移動: dx = sin(_dir)*speed, dz = cos(_dir)*speed
//    旋轉: rotate(_dir * 180/PI, 0, 1, 0)
//
//  ── 靜態網格模式（staticMesh: true）────────────────────────────
//    當 GLTF 沒有 skins / animations 時（例如 Smiler），
//    自動偵測並切換成靜態網格渲染，不走骨骼蒙皮路徑。
//    此模式下 facePlayer: true 可讓模型永遠面向玩家。
// ================================================================

// ──────────────────────────────────────────────────────────────────
//  共用 Shader（骨骼蒙皮版，供有 skins 的怪物使用）
// ──────────────────────────────────────────────────────────────────
var _NPC_SHARED = {
    prog : null,
    loc  : null,
    gl   : null,
};

// ──────────────────────────────────────────────────────────────────
//  靜態網格 Shader（無骨骼版，Smiler 專用偏光自發光效果）
// ──────────────────────────────────────────────────────────────────
var _NPC_STATIC_SHARED = {
    prog : null,
    loc  : null,
    gl   : null,
};

// ── 骨骼蒙皮 Vertex Shader ────────────────────────────────────────
var _VS = `
    attribute vec3 a_Pos;
    attribute vec3 a_Nrm;
    attribute vec4 a_Joints;
    attribute vec4 a_Weights;

    uniform mat4 u_ViewProj;
    uniform mat4 u_Model;
    uniform mat4 u_JointMat[65];

    varying vec3 v_Normal;
    varying vec3 v_WorldPos;

    void main() {
        mat4 skin =
            a_Weights.x * u_JointMat[int(a_Joints.x)] +
            a_Weights.y * u_JointMat[int(a_Joints.y)] +
            a_Weights.z * u_JointMat[int(a_Joints.z)] +
            a_Weights.w * u_JointMat[int(a_Joints.w)];

        vec4 skinnedPos = skin * vec4(a_Pos, 1.0);
        vec4 worldPos   = u_Model * skinnedPos;
        gl_Position     = u_ViewProj * worldPos;
        v_WorldPos      = worldPos.xyz;

        vec3 skinnedNrm = mat3(skin) * a_Nrm;
        v_Normal = normalize(mat3(u_Model) * skinnedNrm);
    }`;

// ── 靜態網格 Vertex Shader（Smiler 偏光版，傳 viewDir 給 fragment）──
var _VS_STATIC = `
    attribute vec3 a_Pos;
    attribute vec3 a_Nrm;

    uniform mat4 u_ViewProj;
    uniform mat4 u_Model;
    uniform mat4 u_NodeMat;
    uniform vec3 u_EyePos;

    varying vec3 v_Normal;
    varying vec3 v_WorldPos;
    varying vec3 v_ViewDir;

    void main() {
        vec4 worldPos = u_Model * u_NodeMat * vec4(a_Pos, 1.0);
        gl_Position   = u_ViewProj * worldPos;
        v_WorldPos    = worldPos.xyz;
        v_Normal  = normalize(mat3(u_Model) * mat3(u_NodeMat) * a_Nrm);
        v_ViewDir = normalize(u_EyePos - worldPos.xyz);
    }`;

// ── Smiler 專用 Fragment Shader（偏光 + 自發光）──────────────────
var _FS_STATIC = `
    precision mediump float;

    varying vec3 v_Normal;
    varying vec3 v_WorldPos;
    varying vec3 v_ViewDir;

    uniform vec3 u_EyePos;
    uniform vec3 u_LightPos;
    uniform vec3 u_LightColor;
    uniform float u_Time;

    vec3 iridescence(float f) {
        float t = fract(f * 1.5 + u_Time * 0.3);
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.00, 0.33, 0.67);
        return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
        vec3 norm    = normalize(v_Normal);
        vec3 viewDir = normalize(v_ViewDir);
        if (dot(norm, viewDir) < 0.0) norm = -norm;

        float fresnel = pow(1.0 - abs(dot(norm, viewDir)), 1.5);
        vec3 iriColor = iridescence(fresnel);

        // 自發光底色：黑暗中也能看見的微弱綠光
        vec3 emissive = vec3(0.05, 0.12, 0.04);

        vec3 lightDir = normalize(u_LightPos - v_WorldPos);
        vec3 halfDir  = normalize(viewDir + lightDir);
        float spec    = pow(max(dot(halfDir, norm), 0.0), 32.0);
        vec3 specular = iriColor * spec * 0.8;

        vec3 rim = iriColor * fresnel * 0.6;

        vec3 color = emissive + specular + rim;
        color = color / (color + 0.8);

        gl_FragColor = vec4(color, 1.0);
    }`;

// ── 共用 Fragment Shader ──────────────────────────────────────────
var _FS = `
    precision mediump float;

    varying vec3 v_Normal;
    varying vec3 v_WorldPos;

    uniform vec3 u_BaseColor;
    uniform vec3 u_EyePos;
    uniform vec3 u_LightPos;
    uniform vec3 u_AmbientColor;
    uniform vec3 u_LightColor;

    void main() {
        vec3 norm     = normalize(v_Normal);
        vec3 lightDir = normalize(u_LightPos - v_WorldPos);
        if (dot(norm, lightDir) < 0.0) norm = -norm;

        vec3 ambient  = u_AmbientColor * u_BaseColor * 0.4;

        float diff    = max(dot(lightDir, norm), 0.0);
        vec3 diffuse  = u_LightColor * u_BaseColor * diff * 0.5;

        vec3 eyeDir   = normalize(u_EyePos - v_WorldPos);
        vec3 halfDir  = normalize(eyeDir + lightDir);
        float spec    = pow(max(dot(halfDir, norm), 0.0), 64.0);
        vec3 specular = u_LightColor * vec3(0.04) * spec;

        gl_FragColor  = vec4(ambient + diffuse + specular, 1.0);
    }`;

// ──────────────────────────────────────────────────────────────────
//  內部 shader 工具
// ──────────────────────────────────────────────────────────────────
function _npcCompile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error('[NPC shader] ' + gl.getShaderInfoLog(s));
    return s;
}

function _npcBuildProg(gl) {
    var p = gl.createProgram();
    gl.attachShader(p, _npcCompile(gl, gl.VERTEX_SHADER,   _VS));
    gl.attachShader(p, _npcCompile(gl, gl.FRAGMENT_SHADER, _FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('[NPC prog] ' + gl.getProgramInfoLog(p));
    return p;
}

function _npcBuildStaticProg(gl) {
    var p = gl.createProgram();
    gl.attachShader(p, _npcCompile(gl, gl.VERTEX_SHADER,   _VS_STATIC));
    gl.attachShader(p, _npcCompile(gl, gl.FRAGMENT_SHADER, _FS_STATIC)); // ★ Smiler 專用偏光 shader
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('[NPC static prog] ' + gl.getProgramInfoLog(p));
    return p;
}

// ──────────────────────────────────────────────────────────────────
//  工廠函式：createNPC(cfg)
//
//  cfg 欄位（皆可選，有預設值）：
//    posX, posY, posZ   — 初始世界座標
//    scale              — Walking 模式縮放（預設 150.0）
//    runScale           — Running 模式縮放（預設 0.3）
//    speed              — 巡邏速度（預設 0.02）
//    chaseSpeed         — 追擊速度（預設 0.08）
//    animSpeed          — Walking 動畫速度（預設 0.8）
//    chaseAnimSpeed     — Running 動畫速度（預設 0.8）
//    chaseDist          — 觸發追擊距離（預設 15.0）
//    walkDir            — 走路模型目錄
//    runDir             — 奔跑模型目錄
//    facePlayer         — true = 永遠面向玩家（靜態模式自動啟用）
// ──────────────────────────────────────────────────────────────────
function createNPC(cfg) {
    cfg = cfg || {};

    // ── 實例設定 ────────────────────────────────────────────────
    var _cfg = {
        type          : cfg.type          || '',
        posX          : cfg.posX          !== undefined ? cfg.posX          : 27.0,
        posY          : cfg.posY          !== undefined ? cfg.posY          : 0.0,
        posZ          : cfg.posZ          !== undefined ? cfg.posZ          : 27.0,
        scale         : cfg.scale         !== undefined ? cfg.scale         : 150.0,
        runScale      : cfg.runScale      !== undefined ? cfg.runScale      : 0.3,
        speed         : cfg.speed         !== undefined ? cfg.speed         : 0.02,
        chaseSpeed    : cfg.chaseSpeed    !== undefined ? cfg.chaseSpeed    : 0.08,
        animSpeed     : cfg.animSpeed     !== undefined ? cfg.animSpeed     : 0.8,
        chaseAnimSpeed: cfg.chaseAnimSpeed !== undefined ? cfg.chaseAnimSpeed : 0.8,
        chaseDist     : cfg.chaseDist     !== undefined ? cfg.chaseDist     : 15.0,
        catchDist     : cfg.catchDist     !== undefined ? cfg.catchDist     : 1.5,
        eyeY          : cfg.eyeY          !== undefined ? cfg.eyeY          : 2.0,
        walkDir       : cfg.walkDir       || 'backroom_charactors/skinstealer/skinstealer_Walking/',
        runDir        : cfg.runDir        || 'backroom_charactors/skinstealer/skinstealer_Running/',
        baseColor     : cfg.baseColor     || [0.85, 0.78, 0.55],
        nightOnly     : cfg.nightOnly     || false,
        facePlayer    : cfg.facePlayer    !== undefined ? cfg.facePlayer : false,
    };

    // ── 實例私有狀態 ────────────────────────────────────────────
    var _gl         = null;
    var _ready      = false;
    var _runReady   = false;

    // ★ 靜態網格模式旗標（解析 GLTF 後自動判斷）
    var _isStatic   = false;
    var _staticPrimitives = [];   // { bufPos, bufNrm, bufIdx, count, idxType, nodeMat }

    var _gltf       = null;
    var _binData    = null;
    var _runGltf    = null;
    var _runBinData = null;

    var _walkData   = null;
    var _runData    = null;

    var _primitives    = [];
    var _joints        = [];
    var _invBindMats   = [];
    var _animChannels  = [];
    var _animDuration  = 1.0;
    var _animTime      = 0.0;
    var _runAnimChannels = [];
    var _runAnimDuration = 1.0;

    var _chasing       = false;
    var _caught        = false;
    var _chaseAnimTime = 0.0;
    var _playerPos     = { x: 0, y: 0, z: 0 };

    // ── 手電筒照射消失狀態 ─────────────────────────────────────────
    var _vanished      = false;   // 是否正在消失中
    var _vanishTimer   = 0.0;     // 距離重現的倒數秒數（performance.now 毫秒）

    var _x = _cfg.posX, _y = _cfg.posY, _z = _cfg.posZ;
    var _dir = 0;
    var _prevX = _x, _prevZ = _z;
    var _stuckFrames = 0;

    var STUCK_THRESHOLD = 0.001;
    var STUCK_FRAMES    = 8;
    var NPC_RADIUS      = 0.3;

    var _nodeTrans = [];
    var _nodeRot   = [];
    var _nodeScale = [];

    var _lastTime  = null;
    var _jointMats = null;

    // ── Accessor ──────────────────────────────────────────────────
    function _readAccessor(gltf, binData, accIdx) {
        var acc        = gltf.accessors[accIdx];
        var bv         = gltf.bufferViews[acc.bufferView];
        var bvOffset   = bv.byteOffset  || 0;
        var accOffset  = acc.byteOffset || 0;
        var count      = acc.count;
        var typeElem   = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 }[acc.type];
        var totalElem  = count * typeElem;
        var byteStride = bv.byteStride || 0;

        var ctMap = {
            5126: [Float32Array, 4],
            5123: [Uint16Array,  2],
            5121: [Uint8Array,   1],
            5125: [Uint32Array,  4],
        };
        var ct = ctMap[acc.componentType];
        if (!ct) {
            console.warn('[NPC] 未支援 componentType', acc.componentType);
            return null;
        }
        var TypedArray   = ct[0];
        var bytesPerElem = ct[1];
        var elemStride   = byteStride / bytesPerElem;

        if (!byteStride || byteStride === typeElem * bytesPerElem) {
            var byteOffset = bvOffset + accOffset;
            return new TypedArray(binData, byteOffset, totalElem);
        }

        var out     = new TypedArray(totalElem);
        var srcView = new TypedArray(binData);
        var srcBase = (bvOffset + accOffset) / bytesPerElem;
        for (var i = 0; i < count; i++) {
            var src = srcBase + i * elemStride;
            var dst = i * typeElem;
            for (var e = 0; e < typeElem; e++) out[dst + e] = srcView[src + e];
        }
        return out;
    }

    // ── 靜態網格解析 ──────────────────────────────────────────────
    // 適用於沒有 skins / animations 的 GLTF（Smiler 等）
    // 保留 GLTF 節點的原始 matrix 以正確套用座標系轉換
    function _parseStaticGLTFData(gltf, binData) {
        var gl = _gl;

        // 計算每個節點的全域 matrix（處理 node.matrix 或 TRS）
        var nodeCount   = gltf.nodes.length;
        var globalMats  = new Array(nodeCount);

        function _identity() {
            return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        }

        function _mulMat4(a, b) {
            var out = new Float32Array(16);
            for (var col = 0; col < 4; col++)
                for (var row = 0; row < 4; row++) {
                    var sum = 0;
                    for (var k = 0; k < 4; k++) sum += a[k*4+row] * b[col*4+k];
                    out[col*4+row] = sum;
                }
            return out;
        }

        function _nodeLocalMat(node) {
            if (node.matrix) {
                // GLTF matrix 是 column-major，直接用
                return new Float32Array(node.matrix);
            }
            // TRS → mat4
            var t = node.translation || [0,0,0];
            var r = node.rotation    || [0,0,0,1];
            var s = node.scale       || [1,1,1];
            var x=r[0],y=r[1],z=r[2],w=r[3];
            var x2=x+x,y2=y+y,z2=z+z;
            var xx=x*x2,xy=x*y2,xz=x*z2;
            var yy=y*y2,yz=y*z2,zz=z*z2;
            var wx=w*x2,wy=w*y2,wz=w*z2;
            var m = new Float32Array(16);
            m[0]=(1-(yy+zz))*s[0]; m[1]=(xy+wz)*s[0];     m[2]=(xz-wy)*s[0];     m[3]=0;
            m[4]=(xy-wz)*s[1];     m[5]=(1-(xx+zz))*s[1]; m[6]=(yz+wx)*s[1];     m[7]=0;
            m[8]=(xz+wy)*s[2];     m[9]=(yz-wx)*s[2];     m[10]=(1-(xx+yy))*s[2];m[11]=0;
            m[12]=t[0]; m[13]=t[1]; m[14]=t[2]; m[15]=1;
            return m;
        }

        function _calcGlobal(nodeIdx, parentMat) {
            var local = _nodeLocalMat(gltf.nodes[nodeIdx]);
            globalMats[nodeIdx] = parentMat ? _mulMat4(parentMat, local) : local;
            var children = gltf.nodes[nodeIdx].children || [];
            for (var c = 0; c < children.length; c++)
                _calcGlobal(children[c], globalMats[nodeIdx]);
        }
        var rootIdx = gltf.scenes[0].nodes[0];
        _calcGlobal(rootIdx, null);

        // 建立每個 primitive 的 GPU buffer，附上節點的全域 matrix
        var primitives = [];

        function mkBuf(data, type) {
            var b = gl.createBuffer();
            gl.bindBuffer(type || gl.ARRAY_BUFFER, b);
            gl.bufferData(type || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            return b;
        }

        // ★ 計算根節點 matrix 套用後的 AABB center（用於 render 時置中修正）
        // 根節點有 Y/Z 軸交換（Y-up→Z-up），AABB 必須在 transform 後的空間計算
        var _staticCenterAfterRoot = (function() {
            // 原始 AABB（原始頂點空間）
            var minX =  Infinity, minY =  Infinity, minZ =  Infinity;
            var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            gltf.accessors.forEach(function(acc) {
                if (acc.type === 'VEC3' && acc.min && acc.max) {
                    if (acc.min[0] < minX) minX = acc.min[0];
                    if (acc.min[1] < minY) minY = acc.min[1];
                    if (acc.min[2] < minZ) minZ = acc.min[2];
                    if (acc.max[0] > maxX) maxX = acc.max[0];
                    if (acc.max[1] > maxY) maxY = acc.max[1];
                    if (acc.max[2] > maxZ) maxZ = acc.max[2];
                }
            });
            // 原始空間 AABB 的 8 個角，套上根節點 globalMat，求 transform 後 AABB
            var rootMat = globalMats[gltf.scenes[0].nodes[0]];
            var corners = [
                [minX,minY,minZ],[maxX,minY,minZ],[minX,maxY,minZ],[maxX,maxY,minZ],
                [minX,minY,maxZ],[maxX,minY,maxZ],[minX,maxY,maxZ],[maxX,maxY,maxZ],
            ];
            var tMinX= Infinity,tMinY= Infinity,tMinZ= Infinity;
            var tMaxX=-Infinity,tMaxY=-Infinity,tMaxZ=-Infinity;
            corners.forEach(function(c) {
                // column-major matrix * vec4
                var tx = rootMat[0]*c[0] + rootMat[4]*c[1] + rootMat[8]*c[2]  + rootMat[12];
                var ty = rootMat[1]*c[0] + rootMat[5]*c[1] + rootMat[9]*c[2]  + rootMat[13];
                var tz = rootMat[2]*c[0] + rootMat[6]*c[1] + rootMat[10]*c[2] + rootMat[14];
                if (tx<tMinX) tMinX=tx; if (tx>tMaxX) tMaxX=tx;
                if (ty<tMinY) tMinY=ty; if (ty>tMaxY) tMaxY=ty;
                if (tz<tMinZ) tMinZ=tz; if (tz>tMaxZ) tMaxZ=tz;
            });
            return {
                x: (tMinX + tMaxX) * 0.5,
                y: tMinY,                    // 底部貼地
                z: (tMinZ + tMaxZ) * 0.5,
            };
        })();

        console.log('[NPC static] root-space center (for render correction):',
            _staticCenterAfterRoot.x.toFixed(3),
            _staticCenterAfterRoot.y.toFixed(3),
            _staticCenterAfterRoot.z.toFixed(3));

        for (var ni = 0; ni < gltf.nodes.length; ni++) {
            var node = gltf.nodes[ni];
            if (node.mesh === undefined) continue;

            var mesh    = gltf.meshes[node.mesh];
            var nodeMat = globalMats[ni];   // ★ 不動 nodeMat，修正移到 render

            mesh.primitives.forEach(function (prim) {
                var pos = _readAccessor(gltf, binData, prim.attributes['POSITION']);
                var nrm = _readAccessor(gltf, binData, prim.attributes['NORMAL']);
                var idx = _readAccessor(gltf, binData, prim.indices);

                var idxAcc    = prim.indices !== undefined ? gltf.accessors[prim.indices] : null;
                var idxGLType = (idxAcc && idxAcc.componentType === 5125)
                    ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

                primitives.push({
                    bufPos:  mkBuf(pos),
                    bufNrm:  mkBuf(nrm),
                    bufIdx:  mkBuf(idx, gl.ELEMENT_ARRAY_BUFFER),
                    count:   idx.length,
                    idxType: idxGLType,
                    nodeMat: nodeMat,
                });
            });
        }

        // center 資訊存回 primitives 陣列（供 render 使用）
        primitives._center = _staticCenterAfterRoot;

        return primitives;
    }

    // ── 骨骼蒙皮 GLTF 解析 ────────────────────────────────────────
    function _parseGLTFData(gltf, binData) {
        var gl   = _gl;
        var skin = gltf.skins[0];
        var joints = skin.joints;

        var ibmData = _readAccessor(gltf, binData, skin.inverseBindMatrices);
        var invBindMats = [];
        for (var j = 0; j < joints.length; j++) {
            var mat16 = new Float32Array(16);
            for (var m = 0; m < 16; m++) mat16[m] = ibmData[j * 16 + m];
            invBindMats.push(mat16);
        }

        var nodes = gltf.nodes;
        var nodeTrans = new Array(nodes.length);
        var nodeRot   = new Array(nodes.length);
        var nodeScale = new Array(nodes.length);
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            nodeTrans[i] = n.translation ? new Float32Array(n.translation) : new Float32Array([0,0,0]);
            nodeRot[i]   = n.rotation    ? new Float32Array(n.rotation)    : new Float32Array([0,0,0,1]);
            nodeScale[i] = n.scale       ? new Float32Array(n.scale)       : new Float32Array([1,1,1]);
        }

        var primitives = [];
        gltf.meshes.forEach(function (mesh) {
            mesh.primitives.forEach(function (prim) {
                var pos     = _readAccessor(gltf, binData, prim.attributes['POSITION']);
                var nrm     = _readAccessor(gltf, binData, prim.attributes['NORMAL']);
                var jnts    = _readAccessor(gltf, binData, prim.attributes['JOINTS_0']);
                var weights = _readAccessor(gltf, binData, prim.attributes['WEIGHTS_0']);
                var idx     = _readAccessor(gltf, binData, prim.indices);

                function mkBuf(data, type) {
                    var b = gl.createBuffer();
                    gl.bindBuffer(type || gl.ARRAY_BUFFER, b);
                    gl.bufferData(type || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
                    return b;
                }

                var jointsF32 = new Float32Array(jnts.length);
                for (var k = 0; k < jnts.length; k++) jointsF32[k] = jnts[k];

                var idxAcc    = prim.indices !== undefined ? gltf.accessors[prim.indices] : null;
                var idxGLType = (idxAcc && idxAcc.componentType === 5125)
                    ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

                primitives.push({
                    bufPos:     mkBuf(pos),
                    bufNrm:     mkBuf(nrm),
                    bufJoints:  mkBuf(jointsF32),
                    bufWeights: mkBuf(weights),
                    bufIdx:     mkBuf(idx, gl.ELEMENT_ARRAY_BUFFER),
                    count:      idx.length,
                    idxType:    idxGLType,
                });
            });
        });

        var animChannels = [];
        var anim = gltf.animations[0];
        var animDuration = 0;
        anim.channels.forEach(function (ch) {
            var sampler = anim.samplers[ch.sampler];
            var times   = _readAccessor(gltf, binData, sampler.input);
            var values  = _readAccessor(gltf, binData, sampler.output);
            var lastT   = times[times.length - 1];
            if (lastT > animDuration) animDuration = lastT;
            animChannels.push({
                nodeIdx: ch.target.node,
                path:    ch.target.path,
                times:   Array.from(times),
                values:  Array.from(values),
                stride:  ch.target.path === 'rotation' ? 4 : 3,
            });
        });

        return { primitives, joints, invBindMats,
                 animChannels, animDuration,
                 nodeTrans, nodeRot, nodeScale,
                 gltfRef: gltf };
    }

    // ── 靜態模型解析完成 ──────────────────────────────────────────
    function _parseWalkingStatic() {
        _isStatic         = true;
        _staticPrimitives = _parseStaticGLTFData(_gltf, _binData);
        _ready            = true;
        // 靜態模式不需要 _jointMats，直接標記為可渲染
        _jointMats        = true;
        console.log('[NPC] 靜態網格解析完成 | primitives:', _staticPrimitives.length,
            '| type:', _cfg.type);
    }

    // ── 骨骼模型解析完成 ──────────────────────────────────────────
    function _parseWalking() {
        _walkData = _parseGLTFData(_gltf, _binData);
        _joints       = _walkData.joints;
        _invBindMats  = _walkData.invBindMats;
        _animChannels = _walkData.animChannels;
        _animDuration = _walkData.animDuration;
        _nodeTrans    = _walkData.nodeTrans;
        _nodeRot      = _walkData.nodeRot;
        _nodeScale    = _walkData.nodeScale;
        _primitives   = _walkData.primitives;
        _ready = true;
        console.log('[NPC] Walking 解析完成 | primitives:', _primitives.length,
            '| joints:', _joints.length,
            '| anim duration:', _animDuration.toFixed(2) + 's');
    }

    function _parseRunning() {
        _runData  = _parseGLTFData(_runGltf, _runBinData);
        _runReady = true;
        console.log('[NPC] Running 解析完成 | primitives:', _runData.primitives.length,
            '| joints:', _runData.joints.length,
            '| anim duration:', _runData.animDuration.toFixed(2) + 's');
    }

    // ── 動畫插值 ──────────────────────────────────────────────────
    function _sample(times, values, stride, t) {
        var n = times.length;
        if (t <= times[0])     return values.slice(0, stride);
        if (t >= times[n - 1]) return values.slice((n - 1) * stride, n * stride);
        var lo = 0, hi = n - 2;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (times[mid + 1] <= t) lo = mid + 1; else hi = mid;
        }
        var alpha = (t - times[lo]) / (times[lo + 1] - times[lo]);
        var res = new Array(stride);
        for (var i = 0; i < stride; i++)
            res[i] = values[lo * stride + i] * (1 - alpha)
                   + values[(lo + 1) * stride + i] * alpha;
        if (stride === 4) _normalizeQuat(res);
        return res;
    }

    function _normalizeQuat(q) {
        var l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]);
        if (l < 1e-6) { q[3] = 1; return; }
        q[0]/=l; q[1]/=l; q[2]/=l; q[3]/=l;
    }

    function _trsToMat(t, r, s) {
        var x=r[0], y=r[1], z=r[2], w=r[3];
        var x2=x+x, y2=y+y, z2=z+z;
        var xx=x*x2, xy=x*y2, xz=x*z2;
        var yy=y*y2, yz=y*z2, zz=z*z2;
        var wx=w*x2, wy=w*y2, wz=w*z2;
        var m = new Float32Array(16);
        m[0]=(1-(yy+zz))*s[0]; m[1]=(xy+wz)*s[0];     m[2]=(xz-wy)*s[0];     m[3]=0;
        m[4]=(xy-wz)*s[1];     m[5]=(1-(xx+zz))*s[1]; m[6]=(yz+wx)*s[1];     m[7]=0;
        m[8]=(xz+wy)*s[2];     m[9]=(yz-wx)*s[2];     m[10]=(1-(xx+yy))*s[2];m[11]=0;
        m[12]=t[0]; m[13]=t[1]; m[14]=t[2]; m[15]=1;
        return m;
    }

    function _mulMat(a, b) {
        var out = new Float32Array(16);
        for (var col = 0; col < 4; col++)
            for (var row = 0; row < 4; row++) {
                var sum = 0;
                for (var k = 0; k < 4; k++) sum += a[k*4+row] * b[col*4+k];
                out[col*4+row] = sum;
            }
        return out;
    }

    function _updateAnimation(data, animTime) {
        var channels    = data.animChannels;
        var nodeTrans   = data.nodeTrans;
        var nodeRot     = data.nodeRot;
        var nodeScale   = data.nodeScale;
        var joints      = data.joints;
        var invBindMats = data.invBindMats;
        var gltf        = data.gltfRef;

        for (var i = 0; i < channels.length; i++) {
            var ch  = channels[i];
            var val = _sample(ch.times, ch.values, ch.stride, animTime);
            if      (ch.path === 'translation') nodeTrans[ch.nodeIdx] = val;
            else if (ch.path === 'rotation')    nodeRot  [ch.nodeIdx] = val;
            else if (ch.path === 'scale')       nodeScale[ch.nodeIdx] = val;
        }

        var globalMats = new Array(gltf.nodes.length);
        var rootIdx    = gltf.scenes[0].nodes[0];

        function _calcGlobal(nodeIdx, parentMat) {
            var local = _trsToMat(nodeTrans[nodeIdx], nodeRot[nodeIdx], nodeScale[nodeIdx]);
            globalMats[nodeIdx] = parentMat ? _mulMat(parentMat, local) : local;
            var children = gltf.nodes[nodeIdx].children || [];
            for (var c = 0; c < children.length; c++)
                _calcGlobal(children[c], globalMats[nodeIdx]);
        }
        _calcGlobal(rootIdx, null);

        var jointMats = new Float32Array(joints.length * 16);
        for (var j = 0; j < joints.length; j++) {
            var jm = _mulMat(globalMats[joints[j]], invBindMats[j]);
            jointMats.set(jm, j * 16);
        }
        return jointMats;
    }

    // ── 視線檢測 ──────────────────────────────────────────────────
    function _hasLineOfSight(target) {
        var walls = Physics.getWalls ? Physics.getWalls() : [];
        if (walls.length === 0) return true;

        var eyeY  = _y + 1.6;
        var tEyeY = (target.y || 0) + 1.6;

        var ox = _x,       oy = eyeY,   oz = _z;
        var dx = target.x - ox;
        var dy = tEyeY    - oy;
        var dz = target.z - oz;

        for (var i = 0; i < walls.length; i++) {
            var w = walls[i];
            var tMin = 0.01, tMax = 0.99;

            if (Math.abs(dx) < 1e-9) {
                if (ox < w.minX || ox > w.maxX) continue;
            } else {
                var t1 = (w.minX - ox) / dx;
                var t2 = (w.maxX - ox) / dx;
                if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
                tMin = Math.max(tMin, t1);
                tMax = Math.min(tMax, t2);
                if (tMin > tMax) continue;
            }

            if (Math.abs(dz) < 1e-9) {
                if (oz < w.minZ || oz > w.maxZ) continue;
            } else {
                var t1 = (w.minZ - oz) / dz;
                var t2 = (w.maxZ - oz) / dz;
                if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
                tMin = Math.max(tMin, t1);
                tMax = Math.min(tMax, t2);
                if (tMin > tMax) continue;
            }

            if (Math.abs(dy) < 1e-9) {
                if (oy < w.minY || oy > w.maxY) continue;
            } else {
                var t1 = (w.minY - oy) / dy;
                var t2 = (w.maxY - oy) / dy;
                if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
                tMin = Math.max(tMin, t1);
                tMax = Math.min(tMax, t2);
                if (tMin > tMax) continue;
            }

            return false;
        }
        return true;
    }

    // ── 移動 ──────────────────────────────────────────────────────
    function _moveNPC() {
        var speed = _chasing ? _cfg.chaseSpeed : _cfg.speed;
        var walls = Physics.getWalls ? Physics.getWalls() : [];

        if (_chasing) {
            var toX = _playerPos.x - _x;
            var toZ = _playerPos.z - _z;
            var targetDir = Math.atan2(toX, toZ);
            _dir = targetDir;

            var candidates = [0, Math.PI * 0.25, -Math.PI * 0.25,
                                 Math.PI * 0.5,  -Math.PI * 0.5];
            for (var t = 0; t < candidates.length; t++) {
                var tryDir = targetDir + candidates[t];
                var dx = Math.sin(tryDir) * speed;
                var dz = Math.cos(tryDir) * speed;
                var nx = _x + dx;
                var nz = _z + dz;

                var blocked = false;
                for (var i = 0; i < walls.length; i++) {
                    var w = walls[i];
                    var r = NPC_RADIUS;
                    if (nx+r > w.minX && nx-r < w.maxX &&
                        nz+r > w.minZ && nz-r < w.maxZ &&
                        _y+1.8 > w.minY && _y < w.maxY) {
                        blocked = true; break;
                    }
                }
                if (!blocked) {
                    _dir = tryDir;
                    _x = nx; _z = nz;
                    return;
                }
            }

        } else {
            var baseAngle = (Math.PI / 3) + Math.random() * (Math.PI * 5 / 12);
            var candidates = [0, baseAngle, -baseAngle, Math.PI];

            for (var t = 0; t < candidates.length; t++) {
                var tryDir = _dir + candidates[t];
                var dx = Math.sin(tryDir) * speed;
                var dz = Math.cos(tryDir) * speed;
                var nx = _x + dx;
                var nz = _z + dz;

                var blocked = false;
                for (var i = 0; i < walls.length; i++) {
                    var w = walls[i];
                    var r = NPC_RADIUS;
                    if (nx+r > w.minX && nx-r < w.maxX &&
                        nz+r > w.minZ && nz-r < w.maxZ &&
                        _y+1.8 > w.minY && _y < w.maxY) {
                        blocked = true; break;
                    }
                }
                if (!blocked) {
                    _dir   = tryDir;
                    _prevX = _x; _prevZ = _z;
                    _x = nx; _z = nz;

                    var dist = Math.abs(dx) + Math.abs(dz);
                    _stuckFrames = (dist < STUCK_THRESHOLD) ? _stuckFrames + 1 : 0;
                    if (_stuckFrames > STUCK_FRAMES) {
                        _dir += Math.PI * (0.5 + Math.random() * 0.5);
                        _stuckFrames = 0;
                    }
                    return;
                }
            }
            _dir += Math.PI;
            _stuckFrames = 0;
        }
    }

    // ── 載入 GLTF ─────────────────────────────────────────────────
    function _loadGltf(dir, gltfName, onGltf, onBin) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', dir + gltfName);
        xhr.onload = function () {
            if (xhr.status !== 200) {
                console.error('[NPC] GLTF 載入失敗 (HTTP ' + xhr.status + '):', dir + gltfName);
                return;
            }
            var gltf = JSON.parse(xhr.responseText);
            onGltf(gltf);

            var buf = gltf.buffers && gltf.buffers[0];
            if (!buf || !buf.uri) {
                console.warn('[NPC] 無外部 bin 檔，跳過 bin 載入:', dir + gltfName);
                return;
            }

            var binUri = buf.uri;

            var head = new XMLHttpRequest();
            head.open('HEAD', dir + binUri);
            head.onload = function () {
                if (head.status !== 200) {
                    console.warn('[NPC] bin 檔不存在，跳過:', dir + binUri);
                    return;
                }
                var bxhr = new XMLHttpRequest();
                bxhr.open('GET', dir + binUri);
                bxhr.responseType = 'arraybuffer';
                bxhr.onload  = function () { onBin(gltf, bxhr.response); };
                bxhr.onerror = function () { console.error('[NPC] 無法載入 BIN:', dir + binUri); };
                bxhr.send();
            };
            head.onerror = function () {
                console.warn('[NPC] bin 檔不存在，跳過:', dir + binUri);
            };
            head.send();
        };
        xhr.onerror = function () { console.error('[NPC] 無法載入:', dir + gltfName); };
        xhr.send();
    }

    // ──────────────────────────────────────────────────────────────
    //  init
    // ──────────────────────────────────────────────────────────────
    function init(glCtx) {
        _gl = glCtx;

        _x    = _cfg.posX;
        _y    = _cfg.posY;
        _z    = _cfg.posZ;
        _dir  = 0;
        _prevX = _x; _prevZ = _z;

        // ── 骨骼蒙皮 shader（共用，只建一次）──────────────────────
        if (!_NPC_SHARED.prog) {
            _gl.getExtension('OES_element_index_uint');

            var maxVecs = _gl.getParameter(_gl.MAX_VERTEX_UNIFORM_VECTORS);
            var maxMats = Math.floor(maxVecs / 4);
            if (maxMats < 73)
                console.error('[NPC] uniform 空間不足，需要 ~73 mat4，目前只有', maxMats);

            try { _NPC_SHARED.prog = _npcBuildProg(_gl); }
            catch (e) { console.error('[NPC]', e); return; }

            var p = _NPC_SHARED.prog;
            _NPC_SHARED.loc = {
                a_Pos:         _gl.getAttribLocation (p, 'a_Pos'),
                a_Nrm:         _gl.getAttribLocation (p, 'a_Nrm'),
                a_Joints:      _gl.getAttribLocation (p, 'a_Joints'),
                a_Weights:     _gl.getAttribLocation (p, 'a_Weights'),
                u_ViewProj:    _gl.getUniformLocation(p, 'u_ViewProj'),
                u_Model:       _gl.getUniformLocation(p, 'u_Model'),
                u_JointMat:    _gl.getUniformLocation(p, 'u_JointMat'),
                u_BaseColor:   _gl.getUniformLocation(p, 'u_BaseColor'),
                u_EyePos:      _gl.getUniformLocation(p, 'u_EyePos'),
                u_LightPos:    _gl.getUniformLocation(p, 'u_LightPos'),
                u_AmbientColor:_gl.getUniformLocation(p, 'u_AmbientColor'),
                u_LightColor:  _gl.getUniformLocation(p, 'u_LightColor'),
            };
            _NPC_SHARED.gl = _gl;
        }

        // ── 靜態網格 shader（共用，只建一次）──────────────────────
        if (!_NPC_STATIC_SHARED.prog) {
            try { _NPC_STATIC_SHARED.prog = _npcBuildStaticProg(_gl); }
            catch (e) { console.error('[NPC static]', e); return; }

            var sp = _NPC_STATIC_SHARED.prog;
            _NPC_STATIC_SHARED.loc = {
                a_Pos:         _gl.getAttribLocation (sp, 'a_Pos'),
                a_Nrm:         _gl.getAttribLocation (sp, 'a_Nrm'),
                u_ViewProj:    _gl.getUniformLocation(sp, 'u_ViewProj'),
                u_Model:       _gl.getUniformLocation(sp, 'u_Model'),
                u_NodeMat:     _gl.getUniformLocation(sp, 'u_NodeMat'),
                u_BaseColor:   _gl.getUniformLocation(sp, 'u_BaseColor'),
                u_EyePos:      _gl.getUniformLocation(sp, 'u_EyePos'),
                u_LightPos:    _gl.getUniformLocation(sp, 'u_LightPos'),
                u_AmbientColor:_gl.getUniformLocation(sp, 'u_AmbientColor'),
                u_LightColor:  _gl.getUniformLocation(sp, 'u_LightColor'),
                u_Time:        _gl.getUniformLocation(sp, 'u_Time'),
            };
            _NPC_STATIC_SHARED.gl = _gl;
        }

        // ── 載入 Walking GLTF，依有無 skins 決定走哪條路 ──────────
        _loadGltf(_cfg.walkDir, 'Walking.gltf',
            function (gltf) { _gltf = gltf; },
            function (gltf, bin) {
                _binData = bin;
                // ★ 自動偵測：沒有 skins 或 animations → 靜態網格模式
                if (!gltf.skins || !gltf.animations) {
                    console.log('[NPC] 偵測到靜態網格模型（無骨骼/動畫），切換靜態模式:', _cfg.type);
                    _parseWalkingStatic();
                } else {
                    _parseWalking();
                }
            }
        );

        // ── Running GLTF 只在非靜態模式下載入 ──────────────────────
        // 靜態模式不需要奔跑動畫
        _loadGltf(_cfg.runDir, 'Running.gltf',
            function (gltf) { _runGltf = gltf; },
            function (gltf, bin) {
                // 如果已確認為靜態模式，忽略 Running
                if (_isStatic) return;
                _runBinData = bin;
                if (gltf.skins && gltf.animations) {
                    _parseRunning();
                }
            }
        );
    }

    // ──────────────────────────────────────────────────────────────
    //  update
    // ──────────────────────────────────────────────────────────────
    function update(playerPos) {
        if (!_ready) return;
        if (_caught) return;
        var now = performance.now();
        var dt  = _lastTime ? (now - _lastTime) / 1000 : 0.016;
        dt      = Math.min(dt, 0.05);
        _lastTime = now;

        // ── 消失計時器：到期後重現 ─────────────────────────────────
        if (_vanished) {
            if (now >= _vanishTimer) {
                _vanished = false;
                console.log('[NPC] smiler 重現');
            } else {
                return; // 消失中：跳過移動與追擊
            }
        }

        if (playerPos) _playerPos = playerPos;

        var dx   = _playerPos.x - _x;
        var dz   = _playerPos.z - _z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        _chasing = (dist < _cfg.chaseDist) && _hasLineOfSight(_playerPos);

        if (!_caught && dist < _cfg.catchDist) {
            _caught = true;
            if (typeof onPlayerCaught === 'function') {
                onPlayerCaught(this);
            }
        }

        _moveNPC();

        // 靜態模式不需要更新動畫
        if (_isStatic) return;

        if (_chasing && _runReady) {
            _chaseAnimTime = (_chaseAnimTime + dt * _cfg.chaseAnimSpeed) % _runData.animDuration;
            _jointMats = _updateAnimation(_runData, _chaseAnimTime);
        } else {
            _animTime = (_animTime + dt * _cfg.animSpeed) % _walkData.animDuration;
            _jointMats = _updateAnimation(_walkData, _animTime);
        }
    }

    // ──────────────────────────────────────────────────────────────
    //  render
    // ──────────────────────────────────────────────────────────────
    function render(playerPos, projMat, viewMat, lightState) {
        if (!_ready || !_jointMats) return;
        if (_vanished) return;   // ★ 消失中不渲染
        var gl = _gl;

        // ════════════════════════════════════════════════════════
        //  ★ 靜態網格渲染路徑（Smiler 等無骨骼模型）
        // ════════════════════════════════════════════════════════
        if (_isStatic) {
            var loc = _NPC_STATIC_SHARED.loc;
            gl.useProgram(_NPC_STATIC_SHARED.prog);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.disable(gl.CULL_FACE);

            var vpMat = new Matrix4(projMat);
            vpMat.multiply(viewMat);
            gl.uniformMatrix4fv(loc.u_ViewProj, false, vpMat.elements);

            var sc = _cfg.scale * 100.0;

            // ★ 永遠面向玩家（facePlayer = true，靜態模式預設啟用）
            var deg;
            if (_cfg.facePlayer || _cfg.type === 'smiler') {
                var toDx = playerPos.x - _x;
                var toDz = playerPos.z - _z;
                deg = Math.atan2(toDx, toDz) * 180.0 / Math.PI;
            } else {
                deg = _dir * 180.0 / Math.PI;
            }

            var mdl = new Matrix4();
            mdl.setTranslate(_x, _y, _z);
            mdl.rotate(deg, 0, 1, 0);
            mdl.scale(sc, sc, sc);
            // ★ 在 scale 之後，用根節點 matrix 套用後的 AABB center 反向修正中心偏移
            // 這樣 nodeMat（含 Y-up→Z-up 交換）的方向才是正確的，修正量也在同一空間
            var c = _staticPrimitives._center;
            if (c) mdl.translate(-c.x, -c.y, -c.z);
            gl.uniformMatrix4fv(loc.u_Model, false, mdl.elements);

            // ★ 時間（偏光動畫）
            gl.uniform1f(loc.u_Time, performance.now() * 0.001);

            var eyeArr = lightState ? lightState.eyePos
                : [playerPos.x, playerPos.y, playerPos.z];
            // ★ 傳眼睛位置給 vertex shader 計算 viewDir
            gl.uniform3fv(loc.u_EyePos, eyeArr);

            if (lightState) {
                gl.uniform3fv(loc.u_LightPos,      lightState.lightPos);
                gl.uniform3fv(loc.u_AmbientColor,  lightState.ambientColor);
                gl.uniform3fv(loc.u_LightColor,    lightState.lightColor);
            } else {
                gl.uniform3fv(loc.u_LightPos,      [playerPos.x, playerPos.y, playerPos.z]);
                gl.uniform3fv(loc.u_AmbientColor,  [0.38, 0.34, 0.24]);
                gl.uniform3fv(loc.u_LightColor,    [1.0, 0.95, 0.82]);
            }
            // BaseColor 不傳（_FS_STATIC 不使用）

            _staticPrimitives.forEach(function (p) {
                // 每個 primitive 有自己的節點 matrix（處理 Y-up/Z-up 轉換等）
                gl.uniformMatrix4fv(loc.u_NodeMat, false, p.nodeMat);

                gl.bindBuffer(gl.ARRAY_BUFFER, p.bufPos);
                gl.enableVertexAttribArray(loc.a_Pos);
                gl.vertexAttribPointer(loc.a_Pos, 3, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, p.bufNrm);
                gl.enableVertexAttribArray(loc.a_Nrm);
                gl.vertexAttribPointer(loc.a_Nrm, 3, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.bufIdx);
                gl.drawElements(gl.TRIANGLES, p.count, p.idxType || gl.UNSIGNED_SHORT, 0);
            });

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
            return;
        }

        // ════════════════════════════════════════════════════════
        //  骨骼蒙皮渲染路徑（原有邏輯，Skinstealer / Backteria 等）
        // ════════════════════════════════════════════════════════
        var loc = _NPC_SHARED.loc;
        gl.useProgram(_NPC_SHARED.prog);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);

        var vpMat = new Matrix4(projMat);
        vpMat.multiply(viewMat);
        gl.uniformMatrix4fv(loc.u_ViewProj, false, vpMat.elements);

        var sc  = (_chasing && _runReady ? _cfg.runScale : _cfg.scale) * 100.0;

        // 骨骼怪物：依 facePlayer 決定旋轉方式
        var deg;
        if (_cfg.facePlayer) {
            var toDx = playerPos.x - _x;
            var toDz = playerPos.z - _z;
            deg = Math.atan2(toDx, toDz) * 180.0 / Math.PI;
        } else {
            deg = _dir * 180.0 / Math.PI;
        }

        var mdl = new Matrix4();
        mdl.setTranslate(_x, _y, _z);
        mdl.rotate(deg, 0, 1, 0);
        mdl.scale(sc, sc, sc);
        gl.uniformMatrix4fv(loc.u_Model, false, mdl.elements);

        gl.uniformMatrix4fv(loc.u_JointMat, false, _jointMats);

        if (lightState) {
            gl.uniform3fv(loc.u_EyePos,       lightState.eyePos);
            gl.uniform3fv(loc.u_LightPos,      lightState.lightPos);
            gl.uniform3fv(loc.u_AmbientColor,  lightState.ambientColor);
            gl.uniform3fv(loc.u_LightColor,    lightState.lightColor);
        } else {
            gl.uniform3fv(loc.u_EyePos,       [playerPos.x, playerPos.y, playerPos.z]);
            gl.uniform3fv(loc.u_LightPos,      [playerPos.x, playerPos.y, playerPos.z]);
            gl.uniform3fv(loc.u_AmbientColor,  [0.38, 0.34, 0.24]);
            gl.uniform3fv(loc.u_LightColor,    [1.0, 0.95, 0.82]);
        }
        gl.uniform3fv(loc.u_BaseColor, _cfg.baseColor);

        var prims = (_chasing && _runReady) ? _runData.primitives : _walkData.primitives;
        prims.forEach(function (p) {
            gl.bindBuffer(gl.ARRAY_BUFFER, p.bufPos);
            gl.enableVertexAttribArray(loc.a_Pos);
            gl.vertexAttribPointer(loc.a_Pos, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, p.bufNrm);
            gl.enableVertexAttribArray(loc.a_Nrm);
            gl.vertexAttribPointer(loc.a_Nrm, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, p.bufJoints);
            gl.enableVertexAttribArray(loc.a_Joints);
            gl.vertexAttribPointer(loc.a_Joints, 4, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, p.bufWeights);
            gl.enableVertexAttribArray(loc.a_Weights);
            gl.vertexAttribPointer(loc.a_Weights, 4, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.bufIdx);
            gl.drawElements(gl.TRIANGLES, p.count, p.idxType || gl.UNSIGNED_SHORT, 0);
        });

        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
    }

    // ── Public API ────────────────────────────────────────────────
    return {
        init,
        update,
        render,
        cfg:         _cfg,
        getPos:      function ()      { return { x: _x, y: _y, z: _z }; },
        setPos:      function (x,y,z) { _x=x; _y=y; _z=z; },
        setDir:      function (rad)   { _dir=rad; },
        isCaught:    function ()      { return _caught; },
        isChasing:   function ()      { return _chasing; },
        resetCaught: function ()      { _caught = false; },
        isStatic:    function ()      { return _isStatic; },
        // ── 手電筒照射 API ─────────────────────────────────────────
        isVanished:  function ()      { return _vanished; },
        vanish:      function (durationSec) {
            _vanished    = true;
            _vanishTimer = performance.now() + (durationSec || 5.0) * 1000;
            _chasing     = false;
            console.log('[NPC] smiler 被手電筒照到，消失', durationSec, '秒');
        },
        // ── ★ 重生重置：恢復出生位置與所有狀態 ────────────────────
        reset: function () {
            _x            = _cfg.posX;
            _y            = _cfg.posY;
            _z            = _cfg.posZ;
            _dir          = 0;
            _prevX        = _x;
            _prevZ        = _z;
            _caught       = false;
            _chasing      = false;
            _vanished     = false;
            _vanishTimer  = 0;
            _chaseAnimTime= 0;
            _animTime     = 0;
            _stuckFrames  = 0;
            _lastTime     = null;
            _playerPos    = { x: 0, y: 0, z: 0 };
        },
    };
}