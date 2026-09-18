# Axxiom Safety iPhone app

SwiftUI, iOS 17+, iPhone only. The Xcode project is generated from `project.yml` with XcodeGen; do not edit the `.xcodeproj` by hand.

## Prerequisites

- Xcode 27 (App Store) with the iOS simulator runtime. Also add an iOS 17 runtime for oldest-device QA: Xcode → Settings → Components.
- `brew install xcodegen`
- Fill `Configs/Dev.xcconfig` (and Staging/Prod): `SUPABASE_ANON_KEY` from the Supabase project's API settings, `DEVELOPMENT_TEAM` in `Configs/Base.xcconfig` once the Apple Developer organization account exists.

## Build and run

```sh
cd ios
xcodegen generate
open AxxiomSafety.xcodeproj          # pick the "AxxiomSafety Dev" scheme and an iPhone simulator
# or from the command line
xcodebuild -project AxxiomSafety.xcodeproj -scheme "AxxiomSafety Dev" -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild test -project AxxiomSafety.xcodeproj -scheme "AxxiomSafety Dev" -destination 'platform=iOS Simulator,name=iPhone 17'
```

Simulator tips: `xcrun simctl privacy booted grant microphone com.axxiomelevator.safetyassistant.dev`; launch with `-forceOffline` to test the offline manual; dictation is unreliable in the simulator, test it on a device.

## Layout

- `App/`: entry point, root tabs, router, build environment.
- `Core/Networking`: SSE parser, API client with token refresh and one safe retry, typed events.
- `Core/Auth`: `AuthProviding` protocol; `SupabaseAuthProvider` for the pilot (swap in MSAL or AppAuth later).
- `Core/Persistence`: SwiftData models (conversations, messages, citations, manual version) and manual file storage.
- `Core/Speech`: on-device dictation, read-aloud.
- `Features/Chat`, `Features/Manual` (download, verify, offline search, highlighted reader), `Features/Emergency`, `Features/Settings`, `Features/Auth`.

## Distribution

TestFlight through Xcode Cloud (`ci_scripts/ci_post_clone.sh` regenerates the project). Production through Apple Business Manager Custom Apps; see the repo `docs/`.
