@echo off
cd /d "%~dp0"
node -e "
const lt = require('localtunnel');
const http = require('http');

// Create a simple proxy server that adds bypass headers
const server = http.createServer((req, res) => {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: req.url,
    method: req.method,
    headers: Object.assign({}, req.headers, {
      'bypass-tunnel-reminder': 'true',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
  };

  const clientReq = http.request(options, (clientRes) => {
    res.writeHead(clientRes.statusCode, clientRes.headers);
    clientRes.pipe(res);
  });

  req.pipe(clientReq);
  clientReq.on('error', (e) => {
    console.error('Proxy error:', e);
    res.writeHead(502);
    res.end('Bad Gateway');
  });
});

server.listen(3001, 'localhost', () => {
  console.log('Local proxy server running on port 3001');
  
  lt({port: 3001}).then(t=> { 
    console.log('URL:', t.url);
    console.log('Copy this link to share with players:');
    console.log(t.url + '/inittrackerplayerview.html?auto=1');
    t.on('close', ()=>console.log('Tunnel closed')); 
  }).catch(err => {
    console.error('Failed to start tunnel:', err);
    process.exit(1);
  });
});
"
pause
