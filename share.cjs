#!/usr/bin/env node
/**
 * 一键分享：起服务器 + 生成二维码 + 打印局域网地址
 *
 * 用法：node share.cjs [端口]
 */
const path = require('node:path');
const { startServer, lanAddresses } = require('./serve.cjs');
const { makeQR } = require('./tools/qr.cjs');

const PORT = Number(process.argv[2] || 8123);

function pickPrimary(ips) {
  return (
    ips.find((ip) => ip.startsWith('192.168.')) ||
    ips.find((ip) => ip.startsWith('10.')) ||
    ips[0] ||
    '127.0.0.1'
  );
}

startServer(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  const primary = pickPrimary(ips);
  const url = `http://${primary}:${PORT}/`;

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  把这个地址发给朋友（连同一个 WiFi 就能打开）║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`     ${url}`);
  console.log('');
  if (ips.length > 1) {
    console.log('  其它可用地址：');
    for (const ip of ips) if (ip !== primary) console.log(`     http://${ip}:${PORT}/`);
    console.log('');
  }

  const qrPath = path.join(__dirname, 'share-qr.png');
  try {
    makeQR(url, qrPath);
    console.log('  ✓ 二维码已生成：share-qr.png（手机扫一扫直接打开）');
    console.log('');
  } catch (e) {
    console.log('  （二维码生成失败：' + e.message + '，用上面的地址也行）');
    console.log('');
  }

  console.log('  ─────────────────────────────────────────────');
  console.log('  服务器运行中，按 Ctrl+C 停止');
  console.log('');
});
