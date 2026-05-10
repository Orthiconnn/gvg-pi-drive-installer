#!/bin/bash
set -e

apt-get install -y hostapd dnsmasq

mkdir -p /opt/pidrive/scripts /opt/pidrive/config

cp /tmp/hostapd.conf /etc/hostapd/hostapd.conf
cp /tmp/hostapd.conf /opt/pidrive/config/hostapd.conf
# dnsmasq-ap.conf goes ONLY to /opt/pidrive/config — NOT to /etc/dnsmasq.d/
# (it's used by a separate dnsmasq instance in ap-start.sh, not the system one)
cp /tmp/dnsmasq-ap.conf /opt/pidrive/config/dnsmasq-ap.conf
cp /tmp/pidrive-ap.service /etc/systemd/system/
cp /tmp/pidrive-wifi-check.service /etc/systemd/system/
cp /tmp/pidrive-wifi-check.timer /etc/systemd/system/

cp /tmp/ap-start.sh /opt/pidrive/scripts/
cp /tmp/ap-stop.sh /opt/pidrive/scripts/
cp /tmp/wifi-check.sh /opt/pidrive/scripts/
chmod +x /opt/pidrive/scripts/ap-start.sh /opt/pidrive/scripts/ap-stop.sh /opt/pidrive/scripts/wifi-check.sh

systemctl daemon-reload
systemctl unmask hostapd
systemctl enable pidrive-wifi-check.timer
systemctl start pidrive-wifi-check.timer

echo "✅ AP fallback installed! SSID: Pi-Drive / Pass: pidrive123"
