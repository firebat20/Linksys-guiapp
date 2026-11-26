# Linksys Router Manager

A cross-platform desktop GUI application for managing Linksys Smart Wi-Fi routers, built with [Go](https://go.dev/), [Wails v3](https://v3.wails.io/), and React + TypeScript.

## Features

- **Router Connection**: Connect to your router over HTTP or HTTPS with saved host history and optional credential storage.
- **Overview**: View router hardware/firmware info, WAN status, system uptime and resource usage, check for or trigger firmware updates, and reboot the router.
- **Devices**: Browse connected and known network devices with search, online/offline filtering, sorting, auto-refresh, and quick DHCP reservation prefill.
- **DHCP Reservations**: View LAN settings and add, edit, or delete static DHCP IP reservations.
- **Security**: View your router password hint and update the admin password.

## Prerequisites

- **Go** 1.27+
- **Node.js** 20+ (with `npm`)
- **Linux only**: GTK 4 and WebKitGTK 6.0 development libraries:
  ```bash
  sudo apt-get update
  sudo apt-get install -y build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev
  ```
- **macOS only**: Xcode Command Line Tools (`xcode-select --install`)

## Building from Source

1. Build the frontend assets (required before `go build` / `go test`, since `frontend/dist` is embedded into the Go binary):

   ```bash
   cd frontend
   npm ci
   npm run build
   cd ..
   ```

2. Build the application binary:

   - **Linux / macOS**:
     ```bash
     go build -tags production -ldflags="-w -s" -o bin/LinksysRouterManager .
     ```
   - **Windows**:
     ```powershell
     go build -tags production -ldflags="-w -s -H windowsgui" -o bin/LinksysRouterManager.exe .
     ```

## Running Tests

After building `frontend/dist`, run the Go test suite:

```bash
go test ./...
```
