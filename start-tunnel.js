#!/usr/bin/env node
import http from 'http';
import { spawn } from 'child_process';

const LOCAL_HOST = '127.0.0.1';
const PROXY_PORT = 3001;
const TARGET_PORT = 3000;
const NGROK_CMD = process.platform === 'win32' ? 'ngrok.exe' : 'ngrok';
const RESTART_DELAY_MS = Number(process.env.NGROK_RESTART_DELAY_MS || 5000);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);
const SERVER_READY_TIMEOUT_MS = Number(process.env.SERVER_READY_TIMEOUT_MS || 60000);
const SERVER_READY_POLL_MS = Number(process.env.SERVER_READY_POLL_MS || 1500);
const HEALTH_CHECK_INTERVAL_MS = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 10000);

let ngrokProcess;
let publishedUrl;
let isShuttingDown = false;
let restartTimer;
let healthTimer;
let wasUpstreamHealthy;

const upstreamAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 64,
  maxFreeSockets: 16,
});

function checkUpstreamReady() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: LOCAL_HOST,
        port: TARGET_PORT,
        path: '/5etools.html',
        method: 'HEAD',
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForUpstream() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    const isReady = await checkUpstreamReady();
    if (isReady) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_READY_POLL_MS));
  }

  return false;
}

function scheduleNgrokRestart(reason) {
  if (isShuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  console.log(`Restarting ngrok in ${RESTART_DELAY_MS}ms (${reason})...`);
  restartTimer = setTimeout(() => {
    publishedUrl = undefined;
    startNgrok();
  }, RESTART_DELAY_MS);
}

function startUpstreamMonitor() {
  if (healthTimer) {
    clearInterval(healthTimer);
  }

  healthTimer = setInterval(async () => {
    if (isShuttingDown) {
      return;
    }

    const healthy = await checkUpstreamReady();
    if (wasUpstreamHealthy === undefined) {
      wasUpstreamHealthy = healthy;
      return;
    }

    if (healthy && !wasUpstreamHealthy) {
      console.log(`Upstream recovered at http://${LOCAL_HOST}:${TARGET_PORT}`);
    }

    if (!healthy && wasUpstreamHealthy) {
      console.warn(`Upstream is down at http://${LOCAL_HOST}:${TARGET_PORT} (tunnel may return 502 until recovered).`);
    }

    wasUpstreamHealthy = healthy;
  }, HEALTH_CHECK_INTERVAL_MS);
}

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
    scheduleNgrokRestart('spawn error');
  });

  ngrokProcess.on('exit', (code, signal) => {
    ngrokProcess = undefined;
    if (isShuttingDown) {
      console.log(`ngrok process exited with ${signal || code}`);
      return;
    }

    console.log(`ngrok exited unexpectedly with ${signal || code}`);
    scheduleNgrokRestart('unexpected exit');
  });
}

function cleanup() {
  isShuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }

  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = undefined;
  }

  if (ngrokProcess && !ngrokProcess.killed) {
    ngrokProcess.kill();
  }

  upstreamAgent.destroy();
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
    agent: upstreamAgent,
    timeout: UPSTREAM_TIMEOUT_MS,
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

  clientReq.on('timeout', () => {
    clientReq.destroy(new Error(`Upstream timed out after ${UPSTREAM_TIMEOUT_MS}ms`));
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

server.listen(PROXY_PORT, LOCAL_HOST, async () => {
  console.log(`Local proxy server running on port ${PROXY_PORT}`);

  wasUpstreamHealthy = await checkUpstreamReady();
  if (wasUpstreamHealthy) {
    console.log(`Upstream is healthy at http://${LOCAL_HOST}:${TARGET_PORT}`);
  } else {
    console.warn(`Upstream is currently down at http://${LOCAL_HOST}:${TARGET_PORT}`);
  }

  const upstreamReady = await waitForUpstream();
  if (!upstreamReady) {
    console.warn(`Server on ${LOCAL_HOST}:${TARGET_PORT} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms.`);
    console.warn('Tunnel will still start and retry in the background; start-server.bat if needed.');
  }

  startUpstreamMonitor();
  startNgrok();
});
