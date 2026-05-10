#!/bin/bash
# Pi-Drive Installer — one-line install:
# curl -sSL https://raw.githubusercontent.com/Orthiconnn/gvg-pi-drive-installer/main/install.sh | sudo bash
set -e

REPO="https://github.com/Orthiconnn/gvg-pi-drive-installer"
RAW="https://raw.githubusercontent.com/Orthiconnn/gvg-pi-drive-installer/main"
INSTALL_DIR="/opt/pidrive"

echo "╔══════════════════════════════════════════╗"
echo "║         Pi-Drive Installer v1.0          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: Run as root: curl -sSL $RAW/install.sh | sudo bash"
  exit 1
fi

# Check for Pi Zero 2 W / ARM
ARCH=$(uname -m)
if [[ "$ARCH" != arm* ]] && [[ "$ARCH" != aarch64 ]]; then
  echo "WARNING: This script is designed for Raspberry Pi (ARM). Detected: $ARCH"
  read -r -p "Continue anyway? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# Install git + curl if missing
apt-get update -qq
apt-get install -y -qq git curl

# Clone or update repo
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "▶ Updating existing Pi-Drive installation..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "▶ Downloading Pi-Drive..."
  rm -rf "$INSTALL_DIR"
  git clone --depth=1 "$REPO" "$INSTALL_DIR"
fi

echo "▶ Running setup..."
bash "$INSTALL_DIR/setup.sh"
