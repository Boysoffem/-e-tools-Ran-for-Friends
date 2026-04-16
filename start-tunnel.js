#!/usr/bin/env node
import http from 'http';
import { spawn } from 'child_process';

const LOCAL_HOST = '127.0.0.1';
const PROXY_PORT = 3001;
const TARGET_PORT = 3000;
const NGROK_CMD = process.platform === 'win32' ? 'ngrok.exe' : 'ngrok';

let ngrokProcess;
let publishedUrl;

function printTunnelLinks(url) {
  console.log('\n✓ Tunnel URL:', url);
  console.log('\n📋 Direct link (bypasses tunnel reminder):');
  console.log(`${url}/`);
  console.log('\n🎮 Initiative Tracker (auto-connect):');
  console.log(`${url}/inittrackerplayerview.html?auto=1`);
  console.log('\n💡 TIP: Add "?bypass=true" to any URL to ensure bypass headers\n');
  console.log('Tunnel is running. Press CTRL+C to stop.\n');
}

function startNgrok() {
  const args = ['http', `${PROXY_PORT}`, '--log', 'stdout'];
  console.log('Starting ngrok:', NGROK_CMD, args.join(' '));

  ngrokProcess = spawn(NGROK_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ngrokProcess.stdout.setEncoding('utf8');
  ngrokProcess.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (!publishedUrl) {
      const match = chunk.match(/https?:\/\/[^\s"']+/g);
      if (match) {
        const httpsUrl = match.find(url => url.startsWith('https://'));
        if (httpsUrl) {
          publishedUrl = httpsUrl.replace(/[\r\n]+$/, '');
          printTunnelLinks(publishedUrl);
        }
      }
    }
  });

  ngrokProcess.stderr.setEncoding('utf8');
  ngrokProcess.stderr.on('data', (chunk) => process.stderr.write(chunk));

  ngrokProcess.on('error', (err) => {
    console.error('Failed to start ngrok:', err.message);
    process.exit(1);
  });

  ngrokProcess.on('exit', (code, signal) => {
    console.log(`ngrok process exited with ${signal || code}`);
    process.exit(code ?? (signal ? 0 : 1));
  });
}

function cleanup() {
  if (ngrokProcess && !ngrokProcess.killed) {
    ngrokProcess.kill();
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('bypass-tunnel-reminder', 'true');
  res.setHeader('X-Bypass-Tunnel-Reminder', 'true');
  res.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const options = {
    hostname: LOCAL_HOST,
    port: TARGET_PORT,
    path: req.url === '/' ? '/5etools.html' : req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, {
      'bypass-tunnel-reminder': 'true',
      'X-Bypass-Tunnel-Reminder': 'true',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
  };

  const clientReq = http.request(options, (clientRes) => {
    const responseHeaders = Object.assign({}, clientRes.headers, {
      'bypass-tunnel-reminder': 'true',
      'X-Bypass-Tunnel-Reminder': 'true'
    });

    res.writeHead(clientRes.statusCode, responseHeaders);
    clientRes.pipe(res);
  });

  req.pipe(clientReq);
  clientReq.on('error', (e) => {
    console.error('Proxy error:', e);
    res.writeHead(502);
    res.end('Bad Gateway');
  });
});

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

server.listen(PROXY_PORT, LOCAL_HOST, () => {
  console.log(`Local proxy server running on port ${PROXY_PORT}`);
  startNgrok();
});
