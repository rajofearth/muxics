#!/usr/bin/env bash
#
# Embed AppImage update information into the reserved .upd_info ELF section of an
# electron-builder-produced AppImage, generate the matching .zsync, and keep the
# electron-updater manifest consistent.
#
# electron-builder does not support AppImage-native updates: it reserves a 1 KiB
# zero-filled .upd_info section but never writes to it, and instead ships its own
# updater (embedded blockmap + latest-linux.yml). Repacking with appimagetool (as
# suggested in the AppImage docs) changes the bytes and breaks electron-updater,
# so instead we write the update-information string in place. The file size and
# the appended blockmap are left untouched.
#
# Usage: embed-appimage-update-info.sh <appimage> <update-info> [manifest.yml]
#
#   <appimage>     path to the AppImage to patch (patched in place)
#   <update-info>  e.g. gh-releases-zsync|owner|repo|latest|App-*-x86_64.AppImage.zsync
#   [manifest.yml] optional electron-updater manifest; sha512 is refreshed and the
#                  now-stale blockMapSize is dropped so clients full-download.
#
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <appimage> <update-info> [manifest.yml]" >&2
  exit 2
fi

IMG="$1"
UPDATE_INFO="$2"
MANIFEST="${3:-}"

[ -f "$IMG" ] || { echo "error: AppImage not found: $IMG" >&2; exit 1; }
command -v objdump >/dev/null 2>&1 || { echo "error: objdump (binutils) is required" >&2; exit 1; }
command -v zsyncmake >/dev/null 2>&1 || { echo "error: zsyncmake is required (apt-get install zsync)" >&2; exit 1; }

# Locate the reserved .upd_info section. `objdump -h` columns:
#   Idx Name Size VMA LMA FileOff Algn
read -r SIZE_HEX OFF_HEX < <(objdump -h "$IMG" | awk '$2==".upd_info"{print $3, $6; exit}')
if [ -z "${SIZE_HEX:-}" ]; then
  echo "error: $IMG has no .upd_info section" >&2
  exit 1
fi
SIZE=$((16#$SIZE_HEX))
OFF=$((16#$OFF_HEX))
echo ".upd_info section: size=${SIZE} offset=${OFF}"

if [ "${#UPDATE_INFO}" -ge "$SIZE" ]; then
  echo "error: update information (${#UPDATE_INFO} bytes) does not fit in .upd_info (${SIZE} bytes)" >&2
  exit 1
fi

# Write the string in place; the remaining bytes of the section are already NUL.
printf '%s' "$UPDATE_INFO" | dd of="$IMG" bs=1 seek="$OFF" conv=notrunc status=none

# Verify exactly the way AppImageHub does.
IMG_ABS="$(cd "$(dirname "$IMG")" && pwd)/$(basename "$IMG")"
EMBEDDED="$("$IMG_ABS" --appimage-updateinformation 2>/dev/null | tr -d '\0' || true)"
if [ "$EMBEDDED" != "$UPDATE_INFO" ]; then
  echo "error: embedded update information mismatch" >&2
  echo "  expected: $UPDATE_INFO" >&2
  echo "  got:      $EMBEDDED" >&2
  exit 1
fi
echo "embedded update information: $EMBEDDED"

# Generate the .zsync from the final bytes (must run after patching).
zsyncmake -u "$(basename "$IMG")" -o "$IMG.zsync" "$IMG"
echo "wrote $IMG.zsync"

# Keep electron-updater consistent. The patch changed bytes inside the file, so
# the recorded sha512 is stale and the embedded blockmap no longer matches; drop
# blockMapSize so the client performs a full download instead of a bad delta.
if [ -n "$MANIFEST" ] && [ -f "$MANIFEST" ]; then
  NEW_SHA="$(openssl dgst -sha512 -binary "$IMG" | base64 -w0)"
  NEW_SIZE="$(stat -c%s "$IMG")"
  sed -i -E \
    -e "s|^([[:space:]]*sha512:).*|\1 $NEW_SHA|" \
    -e "s|^([[:space:]]*size:).*|\1 $NEW_SIZE|" \
    -e "/^[[:space:]]*blockMapSize:/d" \
    "$MANIFEST"
  echo "refreshed manifest: $MANIFEST"
fi
