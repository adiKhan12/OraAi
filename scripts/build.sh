#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")
echo "Building OraAI v${VERSION}..."

# 1. Compile Swift helpers
echo "Compiling helpers..."
swiftc -O -o helpers/ax-elements helpers/ax-elements.swift -framework Cocoa
swiftc -O -o helpers/input-actions helpers/input-actions.swift -framework CoreGraphics

# 2. Package Electron app
echo "Packaging Electron app..."
npx @electron/packager . OraAI \
  --platform=darwin \
  --arch=arm64 \
  --overwrite \
  --app-bundle-id=com.oraai.app \
  --app-version="${VERSION}" \
  --extend-info=Info.plist \
  --extra-resource=helpers/ax-elements \
  --extra-resource=helpers/input-actions \
  --extra-resource=.env

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
