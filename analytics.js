import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const analyticsFile = path.join(__dirname, 'analytics.json');

// Initialize or load analytics
function loadAnalytics() {
    try {
        if (fs.existsSync(analyticsFile)) {
            return JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
        }
    } catch (err) {
        console.error('Error loading analytics:', err.message);
    }
    return { visits: [], sessions: {} };
}

function saveAnalytics(data) {
    try {
        fs.writeFileSync(analyticsFile, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error saving analytics:', err.message);
    }
}

export function trackVisit(ip) {
    const data = loadAnalytics();
    const now = new Date().toISOString();
    
    // Initialize session if not exists
    if (!data.sessions[ip]) {
        data.sessions[ip] = {
            firstVisit: now,
            lastVisit: now,
            pageViews: 0,
            duration: 0
        };
    }
    
    // Update session
    const session = data.sessions[ip];
    session.pageViews++;
    session.lastVisit = now;
    session.duration = new Date(now) - new Date(session.firstVisit);
    
    // Log visit
    data.visits.push({
        ip,
        timestamp: now,
        url: '/'
    });
    
    // Keep only last 1000 visits
    if (data.visits.length > 1000) {
        data.visits = data.visits.slice(-1000);
    }
    
    saveAnalytics(data);
}

export function getAnalytics() {
    const data = loadAnalytics();
    
    // Calculate stats
    const totalVisits = data.visits.length;
    const uniqueVisitors = Object.keys(data.sessions).length;
    const sessions = Object.entries(data.sessions).map(([ip, session]) => ({
        ip: anonymizeIP(ip),
        firstVisit: session.firstVisit,
        lastVisit: session.lastVisit,
        pageViews: session.pageViews,
        durationMinutes: Math.round(session.duration / 1000 / 60 * 10) / 10
    }));
    
    // Calculate average session duration
    let totalDuration = 0;
    sessions.forEach(s => totalDuration += s.durationMinutes);
    const avgSessionDuration = sessions.length > 0 ? (totalDuration / sessions.length).toFixed(2) : 0;
    
    return {
        totalVisits,
        uniqueVisitors,
        avgSessionDuration: `${avgSessionDuration} minutes`,
        topSessions: sessions.sort((a, b) => b.pageViews - a.pageViews).slice(0, 10),
        allSessions: sessions
    };
}

function anonymizeIP(ip) {
    // Hide last octet for privacy
    const parts = ip.split('.');
    if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
    }
    return ip;
}
