#!/bin/bash
# Pi-Drive USB Gadget - RNDIS (Windows 10) + ECM (Mac) + NCM (Win11/Mac/Linux)
# Triple-protocol: maximum compatibility across all platforms
# Usage: usb-gadget.sh [--storage] [--stop]
set -e

GADGET_DIR="/sys/kernel/config/usb_gadget/pidrive"
IMG="/srv/pidrive.img"
MOUNT="/srv/pidrive"
SIZE_GB=64

WITH_STORAGE=false
DO_STOP=false

for arg in "$@"; do
  case "$arg" in
    --storage) WITH_STORAGE=true ;;
    --stop) DO_STOP=true ;;
  esac
done

stop_gadget() {
  if [ -d "$GADGET_DIR" ]; then
    echo "" > "$GADGET_DIR/UDC" 2>/dev/null || true
    sleep 0.5

    # Remove symlinks from configs
    rm -f "$GADGET_DIR/configs/c.1/rndis.usb0"          2>/dev/null || true
    rm -f "$GADGET_DIR/configs/c.1/ecm.usb1"            2>/dev/null || true
    rm -f "$GADGET_DIR/configs/c.1/ncm.usb2"            2>/dev/null || true
    rm -f "$GADGET_DIR/configs/c.1/mass_storage.usb0"   2>/dev/null || true
    rm -f "$GADGET_DIR/os_desc/c.1"                     2>/dev/null || true

    # Remove functions
    rmdir "$GADGET_DIR/functions/rndis.usb0"            2>/dev/null || true
    rmdir "$GADGET_DIR/functions/ecm.usb1"              2>/dev/null || true
    rmdir "$GADGET_DIR/functions/ncm.usb2"              2>/dev/null || true
    [ -d "$GADGET_DIR/functions/mass_storage.usb0" ] && \
      rmdir "$GADGET_DIR/functions/mass_storage.usb0"   2>/dev/null || true

    # Remove configs and strings
    rmdir "$GADGET_DIR/configs/c.1/strings/0x409"       2>/dev/null || true
    rmdir "$GADGET_DIR/configs/c.1"                     2>/dev/null || true
    rmdir "$GADGET_DIR/strings/0x409"                   2>/dev/null || true
    rmdir "$GADGET_DIR/os_desc"                         2>/dev/null || true
    rmdir "$GADGET_DIR"                                 2>/dev/null || true
  fi

  if mountpoint -q "$MOUNT" 2>/dev/null; then
    sync
    umount "$MOUNT" 2>/dev/null || true
  fi

  modprobe -r g_multi        2>/dev/null || true
  modprobe -r g_ether        2>/dev/null || true
  modprobe -r g_mass_storage 2>/dev/null || true
}

if [ "$DO_STOP" = true ]; then
  stop_gadget
  echo "Gadget stopped"
  exit 0
fi

# ─── Load modules ───
modprobe libcomposite 2>/dev/null || true
modprobe dwc2         2>/dev/null || true
modprobe usb_f_rndis  2>/dev/null || true
modprobe usb_f_ecm    2>/dev/null || true
modprobe usb_f_ncm    2>/dev/null || true

stop_gadget
sleep 0.5

# ─── Create gadget ───
mkdir -p "$GADGET_DIR"
cd "$GADGET_DIR"

echo 0x0525 > idVendor    # Netchip Technology (well-known, Windows auto-installs)
echo 0xa4a2 > idProduct   # Linux Ethernet/RNDIS Gadget
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

# ─── Device strings ───
mkdir -p strings/0x409
echo "fedcba9876543210"         > strings/0x409/serialnumber
echo "Pi-Drive"                 > strings/0x409/manufacturer
echo "Pi-Drive Network Storage" > strings/0x409/product

# ─── Microsoft OS Descriptors (optional — skip if not supported) ───
if [ -d /sys/kernel/config/usb_gadget ]; then
  mkdir -p os_desc 2>/dev/null || true
  echo 1         > os_desc/use          2>/dev/null || true
  echo 0xcd      > os_desc/b_vendor_code 2>/dev/null || true
  echo "MSFT100" > os_desc/qw_sign      2>/dev/null || true
fi

# ─── Single config c.1 with all three protocols ───
mkdir -p configs/c.1/strings/0x409
echo "RNDIS+ECM+NCM" > configs/c.1/strings/0x409/configuration
echo 250              > configs/c.1/MaxPower
echo 0x80             > configs/c.1/bmAttributes

# ─── Function: RNDIS (Windows 10) ───
mkdir -p functions/rndis.usb0
echo 42:61:64:55:53:42 > functions/rndis.usb0/dev_addr
echo 48:6f:73:74:4d:43 > functions/rndis.usb0/host_addr

# Write RNDIS OS descriptor only if the path exists
RNDIS_OS="functions/rndis.usb0/os_desc/interface.rndis"
if [ -d "$RNDIS_OS" ]; then
  echo "RNDIS"   > "$RNDIS_OS/compatible_id"
  echo "5162001" > "$RNDIS_OS/sub_compatible_id"
fi

ln -s functions/rndis.usb0 configs/c.1/

# Link c.1 into os_desc if it exists
[ -d os_desc ] && ln -sf configs/c.1 os_desc/ 2>/dev/null || true

# ─── Function: ECM (macOS native) ───
mkdir -p functions/ecm.usb1
echo 42:61:64:55:53:44 > functions/ecm.usb1/dev_addr
echo 48:6f:73:74:4d:45 > functions/ecm.usb1/host_addr
ln -s functions/ecm.usb1 configs/c.1/

# ─── Function: NCM (Windows 11 + Mac + Linux) ───
mkdir -p functions/ncm.usb2
echo 42:61:64:55:53:45 > functions/ncm.usb2/dev_addr
echo 48:6f:73:74:4d:46 > functions/ncm.usb2/host_addr
ln -s functions/ncm.usb2 configs/c.1/

# ─── Mass Storage (optional) ───
if [ "$WITH_STORAGE" = true ]; then
  if [ ! -f "$IMG" ]; then
    echo "Creating ${SIZE_GB}GB FAT32 disk image (sparse)..."
    dd if=/dev/zero of="$IMG" bs=1 count=0 seek=${SIZE_GB}G 2>/dev/null
    mkfs.vfat -F 32 -n PIDRIVE "$IMG"
  fi

  mkdir -p "$MOUNT"
  if ! mountpoint -q "$MOUNT"; then
    mount -o loop,rw,uid=1000,gid=1000,umask=000,flush "$IMG" "$MOUNT"
  fi

  mkdir -p functions/mass_storage.usb0
  echo 1      > functions/mass_storage.usb0/stall
  echo 0      > functions/mass_storage.usb0/lun.0/cdrom
  echo 0      > functions/mass_storage.usb0/lun.0/ro
  echo 1      > functions/mass_storage.usb0/lun.0/removable
  echo "$IMG" > functions/mass_storage.usb0/lun.0/file
  ln -s functions/mass_storage.usb0 configs/c.1/
fi

# ─── Bind to UDC ───
UDC=$(ls /sys/class/udc 2>/dev/null | head -1)
if [ -z "$UDC" ]; then
  echo "ERROR: No UDC found — is dwc2 loaded and dtoverlay=dwc2 in config.txt?"
  exit 1
fi
echo "$UDC" > UDC
echo "Gadget bound to $UDC (RNDIS=Win10, ECM=Mac, NCM=Win11+Mac+Linux, storage=$WITH_STORAGE)"

sleep 2

# ─── Bring up ALL USB ethernet interfaces with same IP ───
# The kernel creates usb0, usb1, usb2 for each function.
# We bridge them so all share 10.0.0.1.
BRIDGE="br-usb"

# Check if brctl/bridge is available, otherwise fall back to per-interface IP
if command -v brctl >/dev/null 2>&1 || command -v ip >/dev/null 2>&1; then
  # Try bridge approach
  ip link add "$BRIDGE" type bridge 2>/dev/null || true
  
  for iface in usb0 usb1 usb2; do
    if [ -d "/sys/class/net/$iface" ]; then
      ip addr flush dev "$iface" 2>/dev/null || true
      ip link set "$iface" up 2>/dev/null || true
      ip link set "$iface" master "$BRIDGE" 2>/dev/null || true
      echo "  Bridged $iface → $BRIDGE"
    fi
  done
  
  ip addr add 10.0.0.1/24 dev "$BRIDGE" 2>/dev/null || true
  ip link set "$BRIDGE" up 2>/dev/null || true
  echo "Bridge $BRIDGE: 10.0.0.1/24"
else
  # Fallback: assign IP to first available interface
  for iface in usb0 usb1 usb2; do
    if [ -d "/sys/class/net/$iface" ]; then
      ip addr flush dev "$iface" 2>/dev/null || true
      ip addr add 10.0.0.1/24 dev "$iface" 2>/dev/null || true
      ip link set "$iface" up 2>/dev/null || true
      echo "Interface $iface: 10.0.0.1/24"
      break
    fi
  done
fi

# ─── Refresh script for mass storage sync ───
mkdir -p /opt/pidrive
cat > /opt/pidrive/refresh-usb.sh << 'REFRESH'
#!/bin/bash
GADGET_DIR="/sys/kernel/config/usb_gadget/pidrive"
IMG="/srv/pidrive.img"
sync
if [ -f "$GADGET_DIR/functions/mass_storage.usb0/lun.0/file" ]; then
  echo "" > "$GADGET_DIR/functions/mass_storage.usb0/lun.0/file" 2>/dev/null || true
  sleep 0.3
  echo "$IMG" > "$GADGET_DIR/functions/mass_storage.usb0/lun.0/file" 2>/dev/null || true
fi
REFRESH
chmod +x /opt/pidrive/refresh-usb.sh
