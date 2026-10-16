#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app_dir="${1:-WoW Models.app}"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
icon_dir=$(mktemp -d "${TMPDIR:-/tmp}/wow-models-icon.XXXXXX")
trap 'rm -rf "$icon_dir"' EXIT
swift -swift-version 5 native/Icon.swift "$icon_dir/AppIcon.iconset"
iconutil -c icns "$icon_dir/AppIcon.iconset" -o "$app_dir/Contents/Resources/AppIcon.icns"
cp native/Info.plist "$app_dir/Contents/Info.plist"
swiftc -swift-version 5 native/Viewer.swift -o "$app_dir/Contents/MacOS/WoWModels" -framework Cocoa -framework WebKit
touch "$app_dir"
echo "Built $app_dir. Keep it beside server, public, and node_modules."
