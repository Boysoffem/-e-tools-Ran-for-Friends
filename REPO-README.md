# 5etools Local Setup Repository

## 🚀 Quick Setup

1. **Clone & Install:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/5etools-local-setup.git
   cd 5etools-local-setup
   npm install
   ```

2. **Start Server:**
   ```bash
   npm start
   ```

3. **Start Tunnel (new terminal):**
   ```bash
   npm run tunnel
   ```

## 📁 What's Included

- ✅ **Full 5etools v2.27.0** with homebrew enabled
- ✅ **ngrok tunnel proxy** with bypass headers
- ✅ **Analytics dashboard** for tracking usage
- ✅ **Custom startup scripts** for easy launching
- ✅ **Comprehensive documentation**

## 🌐 Access URLs

**Local:**
- Main: `http://localhost:3000/`
- Homebrew: `http://localhost:3000/managebrew.html`
- Analytics: `http://localhost:3000/analytics`

**Remote (via ngrok):**
- Main: `https://[your-ngrok-url].ngrok-free.dev/`
- Tracker: `https://[your-ngrok-url].ngrok-free.dev/inittrackerplayerview.html?auto=1`

## 🏠 Homebrew Setup

1. Visit `/managebrew.html`
2. Click "Add Homebrew" → "Create New"
3. Build your custom content interactively
4. Or upload JSON files to `homebrew/` folder

## 📊 Analytics

Track visitor stats at `/analytics` - shows:
- Total visits
- Unique visitors
- Session duration
- Top sessions by IP

## 🔧 Customization

- **Add content:** Place JSON files in `homebrew/` and update `homebrew/index.json`
- **Modify tunnel:** Edit `start-tunnel.js` for custom headers/behavior
- **Change ports:** Update port numbers in `server.js` and `start-tunnel.js`

## 🛠️ Development

```bash
npm run build    # Build assets
npm test         # Run tests
npm run lint     # Lint code
```

## 📝 Notes

- Homebrew is pre-enabled (`IS_DEPLOYED = undefined`)
- Tunnel includes bypass headers to avoid ngrok reminders
- Analytics stored locally in browser
- Large data files excluded from repo (uncomment in .gitignore to include)

## 🎲 Ready for D&D!

Your 5etools instance is ready for gaming sessions with remote access via ngrok tunnel.