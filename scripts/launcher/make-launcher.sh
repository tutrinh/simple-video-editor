#!/bin/bash
# Builds double-clickable macOS .app launchers on the Desktop:
#
#   VIDSTR Video Editor.app     start the dev server and open the browser
#   Stop VIDSTR.app             shut the dev server back down
#
# Re-run this after moving the project folder — the project path is baked into
# the generated apps.
#
# Usage: ./scripts/launcher/make-launcher.sh [destination-dir]   (default: ~/Desktop)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEST_DIR="${1:-$HOME/Desktop}"

APP_NAME="VIDSTR Video Editor"
STOP_APP_NAME="Stop VIDSTR"

# Renders an SVG to a multi-resolution .icns. Silently skips if no renderer is
# installed — the app still works, it just gets the generic bundle icon.
make_icns() {
  local svg="$1" out="$2" tmp iconset renderer=""
  if command -v rsvg-convert >/dev/null 2>&1; then
    renderer="rsvg"
  elif command -v magick >/dev/null 2>&1; then
    renderer="magick"
  elif python3 -c "import cairosvg" >/dev/null 2>&1; then
    renderer="cairosvg"
  else
    echo "  ! No SVG renderer found (rsvg-convert / magick / cairosvg); skipping icon."
    return 1
  fi

  tmp="$(mktemp -d)"
  iconset="${tmp}/icon.iconset"
  mkdir -p "$iconset"

  for spec in "16:icon_16x16.png" "32:icon_16x16@2x.png" "32:icon_32x32.png" \
              "64:icon_32x32@2x.png" "128:icon_128x128.png" "256:icon_128x128@2x.png" \
              "256:icon_256x256.png" "512:icon_256x256@2x.png" "512:icon_512x512.png" \
              "1024:icon_512x512@2x.png"; do
    size="${spec%%:*}"
    name="${spec##*:}"
    case "$renderer" in
      rsvg)     rsvg-convert -w "$size" -h "$size" "$svg" -o "${iconset}/${name}" ;;
      magick)   magick -background none "$svg" -resize "${size}x${size}" "${iconset}/${name}" ;;
      cairosvg) python3 -c "import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], output_width=int(sys.argv[3]), output_height=int(sys.argv[3]))" "$svg" "${iconset}/${name}" "$size" ;;
    esac
  done

  iconutil -c icns "$iconset" -o "$out"
  rm -rf "$tmp"
}

# $1 app name, $2 script template, $3 icon svg, $4 bundle id suffix
build_app() {
  local name="$1" template="$2" icon_svg="$3" bundle_suffix="$4"
  local app="${DEST_DIR}/${name}.app"

  rm -rf "$app"
  mkdir -p "${app}/Contents/MacOS" "${app}/Contents/Resources"

  sed -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
      -e "s|__APP_NAME__|${name}|g" \
      "$template" >"${app}/Contents/MacOS/run"
  chmod +x "${app}/Contents/MacOS/run"

  local icon_entry=""
  if make_icns "$icon_svg" "${app}/Contents/Resources/AppIcon.icns"; then
    icon_entry="  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
"
  fi

  cat >"${app}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundleExecutable</key>
  <string>run</string>
${icon_entry}  <key>CFBundleIdentifier</key>
  <string>local.simple-video-editor.${bundle_suffix}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  # Ad-hoc sign so Gatekeeper treats it as a stable, unmodified bundle.
  codesign --force --deep --sign - "$app" >/dev/null 2>&1 || true
  # Nudge Finder to pick up the new icon.
  touch "$app"

  echo "  ✓ ${app}"
}

echo "Project: ${PROJECT_DIR}"
echo "Building launchers in ${DEST_DIR}"
build_app "$APP_NAME"      "${SCRIPT_DIR}/launch.sh" "${SCRIPT_DIR}/icon.svg"      "launcher"
build_app "$STOP_APP_NAME" "${SCRIPT_DIR}/stop.sh"   "${SCRIPT_DIR}/icon-stop.svg" "stopper"
echo "Done. Double-click \"${APP_NAME}\" on your Desktop to start the app."
