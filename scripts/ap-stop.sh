#!/bin/bash
# Stop Pi-Drive Wi-Fi AP

# Kill hostapd
pkill hostapd 2>/dev/null || true

# Kill AP dnsmasq instance
if [ -f /run/dnsmasq-ap.pid ]; then
  kill "$(cat /run/dnsmasq-ap.pid)" 2>/dev/null || true
  rm -f /run/dnsmasq-ap.pid
fi

# Flush wlan0 IP (NetworkManager will re-manage it)
ip addr flush dev wlan0 2>/dev/null || true

echo "Pi-Drive AP stopped"
