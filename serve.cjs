#!/usr/bin/env node
/**
 * 极简静态服务器 —— 本机预览 / 同一 WiFi 下分享给手机
 *
 * 用法：
 *   node serve.cjs                  # 默认 8123，允许局域网访问
 *   node serve.cjs 3000             # 换端口
 *   node serve.cjs 3000 127.0.0.1   # 只允许本机
 *
 * 也可以被其它脚本 require：const { startServer, lanAddresses } = require('./serve.cjs')
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) out.push(it.address);
    }
  }
  return out;
}

function createServer() {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    if (urlPath === '/') urlPath = '/index.html';

    const rel = path.normalize(urlPath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(ROOT, rel);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

function startServer(port = 8123, host = '0.0.0.0', onReady) {
  const server = createServer();
  server.listen(port, host, () => {
    if (typeof onReady === 'function') onReady(server, port, host);
  });
  return server;
}

module.exports = { startServer, lanAddresses, ROOT };

// 直接运行时打印信息
if (require.main === module) {
  const PORT = Number(process.argv[2] || 8123);
  const HOST = process.argv[3] || '0.0.0.0';

  startServer(PORT, HOST, () => {
    console.log('');
    console.log('  游戏已启动');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  本机：      http://127.0.0.1:${PORT}/`);
    if (HOST === '0.0.0.0') {
      const ips = lanAddresses();
      if (ips.length) {
        console.log('  局域网（同一 WiFi 的手机/电脑可以打开）：');
        for (const ip of ips) console.log(`              http://${ip}:${PORT}/`);
      }
    } else {
      console.log('  （只允许本机访问，去掉第二个参数即可开放局域网）');
    }
    console.log('  ─────────────────────────────────────────────');
    console.log('  按 Ctrl+C 停止');
    console.log('');
  });
}
