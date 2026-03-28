# TurtleShell.ai — macOS Installer

Builds a signed, notarized `.pkg` for macOS 13+.

## Quick Start

1. Copy `.build-config.example` to `.build-config`
2. Fill in your signing credentials
3. Run `./build.sh` to build unsigned package
4. Run `./sign.sh` to sign and notarize

## Requirements

- macOS 13+
- Xcode Command Line Tools
- Apple Developer ID Installer certificate in Keychain
- App-specific password from appleid.apple.com

## Output

`build/TurtleShell-1.7.0.pkg` — signed, notarized, ready to ship

## Architecture

```
User visits turtleshell.ai
      |
Clicks [ Download for Mac ]
      |
TurtleShell.pkg downloads
      |
Wizard: Welcome -> License -> Install
      |
postinstall.sh runs
      |
Fleet wakes on Docker
      |
Node identity registered
      |
Browser opens -> localhost:3000
      |
Sovereign.
```
