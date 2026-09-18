#!/bin/sh
# Xcode Cloud: the .xcodeproj is generated, not committed.
set -e
brew install xcodegen
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate
