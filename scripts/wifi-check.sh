#!/bin/bash
# Pi-Drive Wi-Fi watchdog
# Runs every 60s via systemd timer.
# If wlan0 has no LAN connection → start AP fallback.
# If wlan0 connects to LAN → stop AP fallback.

AP_SERVICE="pidrive-ap"

is_connected() {
  # connected OR connecting — don't interrupt NM while it's mid-negotiation
  local state
  state=$(nmcli -t -f DEVICE,STATE device status 2>/dev/null | grep "^wlan0:" | cut -d: -f2)
  [[ "$state" == "connected" || "$state" == "connecting" ]]
}

ap_active() {
  systemctl is-active --quiet "$AP_SERVICE"
}

if is_connected; then
  if ap_active; then
    echo "$(date): LAN connected — stopping AP"
    systemctl stop "$AP_SERVICE"
  fi
else
  if ! ap_active; then
    echo "$(date): No LAN Wi-Fi — starting AP fallback"
    systemctl start "$AP_SERVICE"
  fi
fi
