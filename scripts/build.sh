#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")
echo "Building OraAI v${VERSION}..."

# 1. Compile Swift accessibility helper
echo "Compiling accessibility helper..."
swiftc -O -o helpers/ax-elements helpers/ax-elements.swift -framework Cocoa

# 2. Package Electron app
echo "Packaging Electron app..."
npx @electron/packager . OraAI \
  --platform=darwin \
  --arch=arm64 \
  --overwrite \
  --app-bundle-id=com.oraai.app \
  --app-version="${VERSION}" \
  --extend-info=Info.plist \
  --extra-resource=helpers/ax-elements

# 3. Code sign
echo "Signing..."
codesign --force --deep --sign - OraAI-darwin-arm64/OraAI.app

# 4. Create zip for distribution
echo "Creating zip..."
cd OraAI-darwin-arm64
zip -r -y "../OraAI-v${VERSION}-mac-arm64.zip" OraAI.app
cd ..

echo ""
echo "Done! Built OraAI v${VERSION}"
echo "  App:  OraAI-darwin-arm64/OraAI.app"
echo "  Zip:  OraAI-v${VERSION}-mac-arm64.zip"
