# minimal GLB reader helpers (numpy) for the people pipeline
import json, struct, numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def load(f):
    b = open(f, 'rb').read(); assert b[:4] == b'glTF'
    off = 12; j = None; binc = b''
    while off < len(b):
        ln, typ = struct.unpack('<II', b[off:off+8]); chunk = b[off+8:off+8+ln]
        if typ == 0x4E4F534A: j = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
        off += 8 + ln
    return j, binc
def acc(j, binc, i, dequant=True):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]; cnt = a['count']
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0) or dt.itemsize * n
    raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (cnt - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(cnt, dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(cnt, n)
    if dequant and a.get('normalized'):
        mx = {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}[CT[a['componentType']]]
        out = np.maximum(out.astype(np.float64) / mx, -1.0)
    return out
def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def node_local(nd):
    if 'matrix' in nd: return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4); t = nd.get('translation', [0, 0, 0]); r = nd.get('rotation', [0, 0, 0, 1]); s = nd.get('scale', [1, 1, 1])
    M[:3, :3] = quat_to_mat(r) @ np.diag(s); M[:3, 3] = t; return M
def world_mats(j):
    par = {}
    for i, nd in enumerate(j['nodes']):
        for c in nd.get('children', []): par[c] = i
    W = {}
    def w(i):
        if i in W: return W[i]
        L = node_local(j['nodes'][i]); W[i] = (w(par[i]) @ L) if i in par else L; return W[i]
    for i in range(len(j['nodes'])): w(i)
    return W, par
