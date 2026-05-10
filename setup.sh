#!/bin/bash
# Pi-Drive Setup Script — runs ON the Pi as root
# Called automatically by install.sh
# Usage: sudo bash /opt/pidrive/setup.sh
set -e

echo "╔══════════════════════════════════════╗"
echo "║       Pi-Drive Setup Installer       ║"
echo "╚══════════════════════════════════════╝"

if [ "$EUID" -ne 0 ]; then
  echo "ERROR: Run as root (sudo bash setup.sh)"
  exit 1
fi

INSTALL_DIR="/opt/pidrive"
SHARE_DIR="/srv/pidrive"
PI_USER="drive"

# ─── 1. Create system user ───
echo ""
echo "▶ [1/9] Creating system user '$PI_USER'..."
if ! id "$PI_USER" &>/dev/null; then
  useradd -r -m -s /bin/bash "$PI_USER"
  echo "  ✓ User '$PI_USER' created"
else
  echo "  ✓ User '$PI_USER' already exists"
fi

# ─── 2. Enable USB OTG (dwc2) ───
echo ""
echo "▶ [2/9] Enabling USB OTG (dwc2)..."
BOOT_CONFIG=""
if [ -f /boot/firmware/config.txt ]; then
  BOOT_CONFIG="/boot/firmware/config.txt"
elif [ -f /boot/config.txt ]; then
  BOOT_CONFIG="/boot/config.txt"
fi

if [ -n "$BOOT_CONFIG" ]; then
  grep -q "^dtoverlay=dwc2" "$BOOT_CONFIG" || echo "dtoverlay=dwc2" >> "$BOOT_CONFIG"
  echo "  ✓ dwc2 overlay added to $BOOT_CONFIG"
else
  echo "  ⚠ Could not find boot config — add 'dtoverlay=dwc2' manually"
fi

grep -q "^dwc2" /etc/modules || echo "dwc2" >> /etc/modules
grep -q "^libcomposite" /etc/modules || echo "libcomposite" >> /etc/modules
modprobe dwc2 2>/dev/null || true
modprobe libcomposite 2>/dev/null || true
echo "  ✓ dwc2 and libcomposite modules configured"

# ─── 3. Create shared directory ───
echo ""
echo "▶ [3/9] Creating shared directory..."
mkdir -p "$SHARE_DIR"
chown "$PI_USER":"$PI_USER" "$SHARE_DIR"
chmod 777 "$SHARE_DIR"
echo "  ✓ $SHARE_DIR created"

# ─── 4. Install system packages ───
echo ""
echo "▶ [4/9] Installing packages..."
apt-get update -qq
apt-get install -y -qq samba dnsmasq nodejs npm bridge-utils hostapd network-manager > /dev/null 2>&1
echo "  ✓ Packages installed (samba, dnsmasq, nodejs, npm, hostapd, network-manager)"

NODE_VER=$(node --version 2>/dev/null || echo "none")
echo "  ✓ Node.js: $NODE_VER"

# ─── 5. Install Node.js dependencies ───
echo ""
echo "▶ [5/9] Installing Node.js dependencies..."
cd "$INSTALL_DIR/server"
npm install --production --silent 2>/dev/null
chown -R "$PI_USER":"$PI_USER" "$INSTALL_DIR/server/node_modules"
echo "  ✓ npm packages installed"

# ─── 6. Configure Samba ───
echo ""
echo "▶ [6/9] Configuring Samba..."
cp "$INSTALL_DIR/config/smb.conf" /etc/samba/smb.conf
systemctl enable smbd nmbd
systemctl restart smbd nmbd
(echo "pidrive"; echo "pidrive") | smbpasswd -a "$PI_USER" -s
echo "  ✓ Samba configured (user: $PI_USER / pass: pidrive)"

# ─── 7. Configure dnsmasq for USB network ───
echo ""
echo "▶ [7/9] Configuring dnsmasq for USB network..."
cp "$INSTALL_DIR/config/dnsmasq-usb0.conf" /etc/dnsmasq.d/usb0.conf
systemctl enable dnsmasq
systemctl restart dnsmasq 2>/dev/null || true
echo "  ✓ dnsmasq configured for USB (10.0.0.x)"

# ─── 8. Install USB gadget + AP services ───
echo ""
echo "▶ [8/9] Installing systemd services..."

# Make scripts executable
chmod +x "$INSTALL_DIR/config/usb-gadget.sh"
chmod +x "$INSTALL_DIR/scripts/ap-start.sh"
chmod +x "$INSTALL_DIR/scripts/ap-stop.sh"
chmod +x "$INSTALL_DIR/scripts/wifi-check.sh"

# USB Ethernet gadget (ethernet-only, no mass storage)
cp "$INSTALL_DIR/config/pidrive-ethernet.service" /etc/systemd/system/

# Wi-Fi AP fallback
cp "$INSTALL_DIR/config/pidrive-ap.service" /etc/systemd/system/

# Wi-Fi watchdog timer
cp "$INSTALL_DIR/config/pidrive-wifi-check.service" /etc/systemd/system/
cp "$INSTALL_DIR/config/pidrive-wifi-check.timer" /etc/systemd/system/

# Web server
cp "$INSTALL_DIR/config/pidrive-web.service" /etc/systemd/system/

# Mask system hostapd — Raspberry Pi OS enables it by default and it conflicts
# with our AP scripts (spawns a second hostapd instance at boot)
systemctl mask hostapd 2>/dev/null || true

systemctl daemon-reload
systemctl enable pidrive-ethernet
systemctl enable pidrive-wifi-check.timer
systemctl enable pidrive-web
systemctl start pidrive-web

echo "  ✓ USB ethernet service: enabled"
echo "  ✓ Wi-Fi watchdog timer: enabled (checks every 60s)"
echo "  ✓ Web server: started"

# sudoers for web server (nmcli + AP service control)
SUDOERS_FILE="/etc/sudoers.d/pidrive"
cat > "$SUDOERS_FILE" << EOF
$PI_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start pidrive-ethernet
$PI_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop pidrive-ethernet
$PI_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start pidrive-ap
$PI_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop pidrive-ap
$PI_USER ALL=(ALL) NOPASSWD: /usr/bin/nmcli
$PI_USER ALL=(ALL) NOPASSWD: /usr/sbin/shutdown
EOF
chmod 440 "$SUDOERS_FILE"
echo "  ✓ sudoers configured"

# ─── 9. Initial Wi-Fi AP check ───
echo ""
echo "▶ [9/9] Starting Wi-Fi AP fallback check..."
bash "$INSTALL_DIR/scripts/wifi-check.sh" || true
echo "  ✓ Wi-Fi check complete"

# ─── Done ───
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                 Pi-Drive Setup Complete!                 ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Web GUI:    http://pi-drive.local:3000                  ║"
echo "║  USB (Win):  \\\\10.0.0.1\\PiDrive                         ║"
echo "║  USB (Mac):  smb://10.0.0.1/PiDrive                     ║"
echo "║  Wi-Fi SMB:  smb://pi-drive.local/PiDrive               ║"
echo "║  SMB login:  drive / pidrive                             ║"
echo "║                                                          ║"
echo "║  Wi-Fi AP:   SSID=Pi-Drive  Pass=pidrive                 ║"
echo "║  AP Web GUI: http://10.42.0.1:3000                       ║"
echo "║                                                          ║"
echo "║  ⚠  REBOOT REQUIRED for USB ethernet to activate         ║"
echo "║     Run: sudo reboot                                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
