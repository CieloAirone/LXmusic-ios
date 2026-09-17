#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'iOS 原生构建需要 macOS + Xcode。Linux 可运行 npm run check:ios 和 npm run bundle:ios。' >&2
  exit 1
fi
mode="${1:-simulator}"
case "$mode" in prepare|simulator|test|archive) ;; *) echo 'Usage: bash scripts/ios-build.sh [prepare|simulator|test|archive]' >&2; exit 2 ;; esac
export NO_FLIPPER=1
export RCT_NEW_ARCH_ENABLED=0
export NODE_BINARY="$(command -v node)"
mkdir -p build/logs
if [[ "${IOS_SKIP_PREPARE:-0}" != 1 || "$mode" == prepare ]]; then
  if [[ ! -d node_modules ]]; then npm ci --include=dev; fi
  bundle install 2>&1 | tee build/logs/bundle-install.log
  (cd ios && bundle exec pod install) 2>&1 | tee build/logs/pod-install.log
fi
if [[ "$mode" == prepare ]]; then exit 0; fi
common=(-workspace ios/LxMusicMobile.xcworkspace -scheme LxMusicMobile -configuration Release -derivedDataPath build/xcode CODE_SIGNING_ALLOWED=NO)
if [[ "$mode" == simulator ]]; then
  xcodebuild "${common[@]}" -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build 2>&1 | tee build/logs/simulator.log
elif [[ "$mode" == test ]]; then
  destination="${IOS_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16}"
  xcodebuild "${common[@]}" -destination "$destination" -resultBundlePath "build/TestResults-$(date +%s).xcresult" test 2>&1 | tee build/logs/tests.log
else
  xcodebuild "${common[@]}" -sdk iphoneos -destination 'generic/platform=iOS' -archivePath build/LXMusic.xcarchive archive 2>&1 | tee build/logs/archive.log
  app=build/LXMusic.xcarchive/Products/Applications/LxMusicMobile.app
  test -f "$app/main.jsbundle"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist"
  # A fresh staging directory prevents leftovers from earlier archives entering the IPA.
  staging=$(mktemp -d "$PWD/build/ipa-stage.XXXXXX")
  mkdir -p "$staging/Payload"
  ditto "$app" "$staging/Payload/LxMusicMobile.app"
  (cd "$staging" && /usr/bin/zip -qry package.ipa Payload)
  mv "$staging/package.ipa" build/LXMusic-unsigned.ipa
  unzip -tq build/LXMusic-unsigned.ipa
  (cd build && shasum -a 256 LXMusic-unsigned.ipa > LXMusic-unsigned.ipa.sha256)
  echo 'Created build/LXMusic-unsigned.ipa — unsigned, must be signed before installing on an iPhone.'
fi
