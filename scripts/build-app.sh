#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app_dir="${1:-WoW Models.app}"
mkdir -p "$app_dir/Contents/MacOS"
cp native/Info.plist "$app_dir/Contents/Info.plist"
swiftc -swift-version 5 native/Viewer.swift -o "$app_dir/Contents/MacOS/WoWModels" -framework Cocoa -framework WebKit
echo "Built $app_dir. Keep it beside server, public, and node_modules."
