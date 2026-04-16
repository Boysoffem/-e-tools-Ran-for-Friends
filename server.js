import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { exec } from 'child_process';
import { trackVisit, getAnalytics } from './analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkForUpdates() {
    exec('"C:\\Program Files\\Git\\bin\\git.exe" pull', { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
            console.error('Failed to pull updates:', err.message);
        } else {
            console.log('Git pull result:', stdout.trim());
        }
    });
}

function generateAnalyticsHTML(analytics) {
    const topSessions = analytics.topSessions.map(s => `
        <tr>
            <td>${s.ip}</td>
            <td>${s.pageViews}</td>
            <td>${s.durationMinutes} min</td>
            <td>${new Date(s.firstVisit).toLocaleString()}</td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>5etools Analytics</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 20px;
                background: #f5f5f5;
            }
            .container {
                max-width: 1000px;
                margin: 0 auto;
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
                border-bottom: 3px solid #007bff;
                padding-bottom: 10px;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }
            .stat-card {
                background: #f8f9fa;
                padding: 15px;
                border-radius: 5px;
                border-left: 4px solid #007bff;
            }
            .stat-value {
                font-size: 24px;
                font-weight: bold;
                color: #007bff;
            }
            .stat-label {
                color: #666;
                font-size: 12px;
                margin-top: 5px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
            }
            th {
                background: #007bff;
                color: white;
                padding: 10px;
                text-align: left;
            }
            td {
                padding: 10px;
                border-bottom: 1px solid #ddd;
            }
            tr:hover {
                background: #f5f5f5;
            }
            .refresh {
                display: inline-block;
                margin-bottom: 15px;
                padding: 8px 15px;
                background: #007bff;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                border: none;
                cursor: pointer;
            }
            .refresh:hover {
                background: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>📊 5etools Analytics</h1>
            <button class="refresh" onclick="location.reload()">🔄 Refresh</button>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-value">${analytics.totalVisits}</div>
                    <div class="stat-label">Total Clicks</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${analytics.uniqueVisitors}</div>
                    <div class="stat-label">Unique Visitors</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${analytics.avgSessionDuration}</div>
                    <div class="stat-label">Avg. Session Duration</div>
                </div>
            </div>

            <h2>Top Sessions</h2>
            <table>
                <thead>
                    <tr>
                        <th>Visitor IP</th>
                        <th>Page Views</th>
                        <th>Time Spent</th>
                        <th>First Visit</th>
                    </tr>
                </thead>
                <tbody>
                    ${topSessions || '<tr><td colspan="4" style="text-align:center; color:#999;">No data yet</td></tr>'}
                </tbody>
            </table>

            <p style="margin-top: 30px; color: #666; font-size: 12px;">
                ℹ️ Analytics are stored locally. IPs are anonymized for privacy.
            </p>
        </div>
    </body>
    </html>
    `;
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;

    // Handle analytics endpoint
    if (pathname === '/analytics') {
        const analytics = getAnalytics();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(generateAnalyticsHTML(analytics));
        return;
    }

    // Track the visit
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    try {
        trackVisit(ip);
    } catch (err) {
        console.error('Error tracking visit:', err.message);
    }

    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

    // Get the file extension
    const ext = path.extname(filePath);

    // Set content type based on extension
    let contentType = 'text/html';
    switch (ext) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
        case '.jpeg':
            contentType = 'image/jpeg';
            break;
        case '.gif':
            contentType = 'image/gif';
            break;
        case '.svg':
            contentType = 'image/svg+xml';
            break;
        case '.ico':
            contentType = 'image/x-icon';
            break;
        case '.xml':
            contentType = 'application/xml';
            break;
        case '.pdf':
            contentType = 'application/pdf';
            break;
        default:
            contentType = 'text/html';
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
        if (localIP !== 'localhost') break;
    }
    console.log(`Server running at http://localhost:${PORT}/ and http://${localIP}:${PORT}/`);
    checkForUpdates();
    setInterval(checkForUpdates, 1209600000); // Check for updates every two weeks
});