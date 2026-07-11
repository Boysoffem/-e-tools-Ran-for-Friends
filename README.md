# 5etools at Home

Custom self-hosted deployment of 5etools, synced with the official mirror source and configured for remote play via ngrok.

## Goals

- Keep local customizations while tracking upstream 5etools updates
- Provide stable local access for game sessions
- Provide optional remote access for players via tunnel
- Include lightweight local analytics and operational scripts

## Quick Start

### Prerequisites

- Node.js 24+
- Git
- ngrok installed and authenticated (for remote access)

### Install

```bash
npm install
```

### Run Locally

```bash
npm start
```

Local URL: http://localhost:3000/

### Start Tunnel

In a second terminal:

```bash
npm run tunnel
```

### Image Audit

```bash
npm run audit:images
```

## Project Notes

- Upstream source: https://github.com/5etools-mirror-3/5etools-src
- This repo may contain local operational scripts for personal hosting workflows
- Token/image handling supports URL-encoded and accented-name asset fallbacks in the local server

## Support

- 5etools Discord: https://discord.gg/5etools
- Wiki: https://wiki.tercept.net/

## License

MIT. See LICENSE.md.
