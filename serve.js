// 把构建出来的网页包丢到局域网上，手机同 WiFi 直接访问
// 用法： node serve.js            → http://<本机IP>:8080
//        node serve.js 9000       → 换端口
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.argv[2] || 8080);
const ROOT = path.join(__dirname, 'build', 'web-mobile');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
    '.cconb': 'application/octet-stream',
    '.ccon': 'application/octet-stream',
};

if (!fs.existsSync(ROOT)) {
    console.log(`找不到 ${ROOT}`);
    console.log('先在 Cocos 里「构建发布」选 Web Mobile 构建一次。');
    process.exit(1);
}

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }

    fs.readFile(file, (err, data) => {
        if (err) {
            // 不存在的资源回 404 就够，别回 index.html，否则引擎会把整页当成 js 解析
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('已启动：');
    console.log(`  本机   http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const it of list || []) {
            if (it.family === 'IPv4' && !it.internal) console.log(`  手机   http://${it.address}:${PORT}`);
        }
    }
    console.log('手机要和这台电脑连同一个 WiFi，第一次弹防火墙要点允许。');
});
