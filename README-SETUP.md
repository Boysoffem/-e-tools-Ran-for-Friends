# 5etools Local Setup with ngrok Tunneling

A complete local installation of 5etools with ngrok tunneling for remote access.

## Features

- ✅ Full 5etools v2.27.0 installation
- ✅ Homebrew support enabled
- ✅ ngrok tunneling for remote access
- ✅ Analytics dashboard
- ✅ Initiative tracker with auto-connect
- ✅ Custom tunnel proxy with bypass headers

## Quick Start

### Prerequisites
- Node.js v24+
- Git
- ngrok account (free tier works)

### Installation

1. **Clone this repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   cd YOUR_REPO_NAME
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local server:**
   ```bash
   npm start
   # or
   node server.js
   ```

4. **Start the tunnel (in a new terminal):**
   ```bash
   node start-tunnel.js
   ```

## Access URLs

### Local Access
- **Main Site:** `http://localhost:3000/`
- **Homebrew Manager:** `http://localhost:3000/managebrew.html`
- **Analytics:** `http://localhost:3000/analytics`

### Remote Access (via ngrok)
- **Main Site:** `https://YOUR_NGROK_URL.ngrok-free.dev/`
- **Homebrew Manager:** `https://YOUR_NGROK_URL.ngrok-free.dev/managebrew.html`
- **Analytics:** `https://YOUR_NGROK_URL.ngrok-free.dev/analytics`
- **Auto-connect Tracker:** `https://YOUR_NGROK_URL.ngrok-free.dev/inittrackerplayerview.html?auto=1`

## Homebrew Setup

Homebrew is already enabled in this installation. To add custom content:

1. Visit the Homebrew Manager: `http://localhost:3000/managebrew.html`
2. Click "Add Homebrew" → "Create New" to build content interactively
3. Or upload JSON files to the `homebrew/` directory and update `homebrew/index.json`

### JSON Format Example
```json
{
  "_meta": {
    "sources": [{
      "json": "MyContent",
      "abbreviation": "MC",
      "full": "My Custom Content",
      "authors": ["Your Name"],
      "version": "1.0.0"
    }]
  },
  "monster": [{
    "name": "Custom Monster",
    "source": "MyContent",
    "size": "L",
    "type": "dragon",
    "ac": 18,
    "hp": {"average": 150, "formula": "12d10 + 60"},
    "speed": {"walk": 40, "fly": 80},
    "str": 20, "dex": 14, "con": 20,
    "int": 10, "wis": 14, "cha": 12,
    "cr": "8"
  }]
}
```

## VPN Alternative

Instead of ngrok, you can use a VPN for remote access:

1. Stop the tunnel: `Ctrl+C`
2. Find your local IP: `ipconfig` (Windows) or `ifconfig` (Linux/Mac)
3. Share: `http://YOUR_LOCAL_IP:3000/`
4. Ensure everyone connects via the same VPN network

## File Structure

```
5etools-v2.27.0/
├── server.js              # Main HTTP server
├── start-tunnel.js        # ngrok tunnel proxy
├── start-ngrok-tunnel.bat # Windows tunnel launcher
├── js/                    # Core JavaScript files
├── css/                   # Stylesheets
├── data/                  # Game data (JSON)
├── homebrew/              # Custom content
│   └── index.json        # Homebrew manifest
├── prerelease/            # Prerelease content
├── lib/                   # Libraries
├── fonts/                 # Fonts
├── img/                   # Images
└── README-SETUP.md       # This file
```

## Troubleshooting

### Tunnel Issues
- Ensure ngrok is installed and authenticated
- Check firewall settings for ports 3000-3001
- Restart tunnel: `node start-tunnel.js`

### Homebrew Not Showing
- Verify `IS_DEPLOYED = undefined` in `js/utils.js`
- Check `homebrew/index.json` for correct file references
- Clear browser cache

### Analytics Not Working
- Analytics are stored locally in browser storage
- Visit any page to start tracking
- Check `/analytics` endpoint

## Development

### Building Assets
```bash
npm run build
```

### Testing
```bash
npm test
```

### Adding Custom Content
- Place JSON files in `homebrew/` directory
- Update `homebrew/index.json` with file references
- Restart server if needed

## License

This is a modified version of 5etools. See LICENSE.md for details.

## Support

- 5etools Discord: https://discord.gg/5etools
- Wiki: https://wiki.tercept.net/
- GitHub Issues: Create an issue in this repository
