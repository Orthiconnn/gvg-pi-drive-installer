#!/bin/bash
# Start Pi-Drive Wi-Fi AP (fallback hotspot)
# Called by pidrive-ap.service

set -e

AP_IP="10.42.0.1"
IFACE="wlan0"

# Assign static IP to wlan0
ip addr flush dev "$IFACE" 2>/dev/null || true
ip addr add "$AP_IP/24" dev "$IFACE"
ip link set "$IFACE" up

# Start hostapd
hostapd -B /opt/pidrive/config/hostapd.conf

# Start dnsmasq for AP (separate instance on wlan0)
dnsmasq --conf-file=/opt/pidrive/config/dnsmasq-ap.conf --pid-file=/run/dnsmasq-ap.pid

echo "Pi-Drive AP started: SSID=Pi-Drive IP=$AP_IP"
