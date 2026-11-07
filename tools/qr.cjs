/**
 * 二维码生成（纯 Node，无第三方依赖）
 *
 * 用法（命令行）：node tools/make-qr.mjs "http://10.0.0.5:8123/" [输出路径]
 * 用法（代码里）：const { makeQR, encodeQR } = require('./tools/qr.cjs'); makeQR(url, 'out.png');
 *
 * 支持字节模式、纠错等级 M、版本 1~10（约 210 字节以内）。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// 版本 -> M 级：total = 该版本总码字数，ecPerBlock = 每块纠错码字数，blocks = 块数
// 数据容量 = total - ecPerBlock * blocks
const M_TABLE = {
  1: { ecPerBlock: 10, blocks: 1, total: 26 },
  2: { ecPerBlock: 16, blocks: 1, total: 44 },
  3: { ecPerBlock: 26, blocks: 1, total: 70 },
  4: { ecPerBlock: 18, blocks: 2, total: 100 },
  5: { ecPerBlock: 24, blocks: 2, total: 134 },
  6: { ecPerBlock: 16, blocks: 4, total: 172 },
  7: { ecPerBlock: 18, blocks: 4, total: 196 },
  8: { ecPerBlock: 22, blocks: 4, total: 242 },
  9: { ecPerBlock: 22, blocks: 5, total: 292 },
  10: { ecPerBlock: 26, blocks: 5, total: 346 },
};

// 版本 -> 对齐图案中心坐标
const ALIGN_POS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsRemainder(data, degree) {
  const gen = new Array(degree).fill(0);
  gen[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      gen[j] = gfMul(gen[j], root);
      if (j + 1 < degree) gen[j] ^= gen[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  const res = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < degree; i++) res[i] ^= gfMul(gen[i], factor);
  }
  return res;
}

function chooseVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const t = M_TABLE[v];
    const cap = t.total - t.ecPerBlock * t.blocks;
    const header = v <= 9 ? 2 : 3;
    if (len + header <= cap) return v;
  }
  throw new Error('内容太长，放不进二维码（最多约 210 字节）');
}

function encodeQR(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  const version = chooseVersion(bytes.length);
  const t = M_TABLE[version];
  const dataCap = t.total - t.ecPerBlock * t.blocks;

  // --- 比特流 ---
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const maxBits = dataCap * 8;
  push(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const pad = [0xec, 0x11];
  let pi = 0;
  while (bits.length < maxBits) push(pad[pi++ % 2], 8);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCodewords.push(b);
  }

  // --- 分块 + 纠错 + 交织 ---
  const numBlocks = t.blocks;
  const totalData = dataCodewords.length;
  const shortLen = Math.floor(totalData / numBlocks);
  const numLong = totalData % numBlocks;
  const blocks = [];
  let off = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i >= numBlocks - numLong ? 1 : 0);
    const d = dataCodewords.slice(off, off + len);
    off += len;
    blocks.push({ data: d, ec: rsRemainder(d, t.ecPerBlock) });
  }
  const finalCodewords = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.data.length) finalCodewords.push(b.data[i]);
  }
  for (let i = 0; i < t.ecPerBlock; i++) {
    for (const b of blocks) finalCodewords.push(b.ec[i]);
  }

  // --- 建矩阵 ---
  const size = 17 + version * 4;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunc = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFunc = (x, y, dark) => { modules[y][x] = dark; isFunc[y][x] = true; };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunc(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 8; i < size - 8; i++) {
    setFunc(i, 6, i % 2 === 0);
    setFunc(6, i, i % 2 === 0);
  }

  const pos = ALIGN_POS[version];
  for (const ay of pos) {
    for (const ax of pos) {
      if ((ax <= 8 && ay <= 8) || (ax <= 8 && ay >= size - 9) || (ax >= size - 9 && ay <= 8)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(ax + dx, ay + dy, dist !== 1);
        }
      }
    }
  }

  // 格式信息（M 级 + 掩码 0）
  const maskId = 0;
  const eccBits = 0;
  const formatData = (eccBits << 3) | maskId;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const formatBits = ((formatData << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunc(8, i, ((formatBits >>> i) & 1) === 1);
  setFunc(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunc(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunc(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, ((formatBits >>> i) & 1) === 1);
  for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunc(8, size - 15 + i, ((formatBits >>> i) & 1) === 1);
  setFunc(8, size - 8, true);

  if (version >= 7) {
    let vrem = version;
    for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
    const vbits = (version << 12) | vrem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  const maskFn = (x, y) => (x + y) % 2 === 0;

  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && bitIdx < totalBits) {
          const byte = finalCodewords[bitIdx >> 3];
          const bit = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
          modules[y][x] = bit !== maskFn(x, y);
          bitIdx++;
        }
      }
    }
  }

  return { modules, size, version };
}

// ---------- PNG 输出 ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPNG(modules, size, scale = 8, margin = 4) {
  const dim = (size + margin * 2) * scale;
  const raw = Buffer.alloc(dim * (dim * 3 + 1));
  let p = 0;
  for (let y = 0; y < dim; y++) {
    raw[p++] = 0;
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / scale) - margin;
      const my = Math.floor(y / scale) - margin;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && modules[my][mx];
      const v = dark ? 0 : 255;
      raw[p++] = v; raw[p++] = v; raw[p++] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeQR(text, outPath, scale = 8) {
  const { modules, size, version } = encodeQR(text);
  const png = toPNG(modules, size, scale, 4);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, png);
  return { path: outPath, size, version, bytes: png.length };
}

module.exports = { makeQR, encodeQR, toPNG };

// 命令行入口
if (require.main === module) {
  const text = process.argv[2];
  if (!text) {
    console.error('用法：node tools/make-qr.mjs "http://10.0.0.5:8123/" [输出路径]');
    process.exit(1);
  }
  const out = process.argv[3] || path.join(process.cwd(), 'share-qr.png');
  const r = makeQR(text, out);
  console.log(`✓ 二维码已生成：${r.path}`);
  console.log(`  内容：${text}`);
  console.log(`  尺寸：${r.size}x${r.size} 模块（版本 ${r.version}）`);
}
