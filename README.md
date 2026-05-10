# Pi-Drive

Turn a **Raspberry Pi Zero 2 W** into a USB + Wi-Fi network drive with a web file manager — installed in one command.

## Install

```bash
curl -sSL https://raw.githubusercontent.com/Orthiconnn/gvg-pi-drive-installer/main/install.sh | sudo bash
```

Then reboot:
```bash
sudo reboot
```

---

## Access

| Method | Address |
|--------|---------|
| **Web GUI** | `http://pi-drive.local:3000` |
| **USB (Windows)** | `\\10.0.0.1\PiDrive` |
| **USB (Mac/Linux)** | `smb://10.0.0.1/PiDrive` |
| **Wi-Fi SMB** | `smb://pi-drive.local/PiDrive` |
| **SMB login** | `drive` / `pidrive` |

---

## Wi-Fi AP Fallback

If the Pi has no Wi-Fi connection, it automatically broadcasts a hotspot:

- **SSID:** `Pi-Drive`
- **Password:** `pidrive`
- **Web GUI on AP:** `http://10.42.0.1:3000`

Connect to the hotspot, open the Web GUI, go to **Settings → Wi-Fi**, and join your local network. The hotspot shuts off automatically once connected.

---

## Features

- **Web file manager** — upload, download, rename, delete, move, drag & drop
- **Real-time sync** — WebSocket + file watching (changes appear instantly)
- **USB Ethernet** — plug into Mac or Windows via USB-C, Pi appears as a network device (RNDIS/ECM/NCM — works on Win10, Win11, Mac, Linux)
- **Samba share** — accessible from Finder, Explorer, or any SMB client
- **Wi-Fi AP fallback** — always reachable even without a router
- **Wi-Fi manager** — scan and connect to networks from the Web GUI

---

## Requirements

- Raspberry Pi Zero 2 W (or any Pi with USB OTG + Wi-Fi)
- Raspberry Pi OS Lite (Bookworm or Bullseye, headless)
- Internet connection on first install (to download packages)

---

## Updating

Re-run the installer — it pulls the latest code and re-runs setup:

```bash
curl -sSL https://raw.githubusercontent.com/Orthiconnn/gvg-pi-drive-installer/main/install.sh | sudo bash
```

---

## Credentials

| Service | User | Password |
|---------|------|----------|
| Samba (SMB) | `drive` | `pidrive` |
| Wi-Fi AP | — | `pidrive` |
| SSH | `drive` | *(set your own)* |
