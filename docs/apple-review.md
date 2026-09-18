# Getting the app through Apple

Written for whoever submits the app: Luke plus Axxiom IT and whoever signs off on privacy wording.

The Axxiom Safety Assistant is an internal tool, so it is distributed as a **Custom App through Apple Business Manager**, not on the public App Store. Custom apps are still reviewed by Apple, but they are exempt from the "must appeal to a broad audience" judgement that rejects most internal tools. Review normally takes one to three days.

## The distribution path

| Stage | What it is | Review |
|---|---|---|
| Internal TestFlight | Build team and the Safety Manager, up to 100 people | None |
| External TestFlight | The 8 to 12 pilot technicians | Beta App Review, 1 to 2 days, light |
| Custom App (production) | Every technician, installed silently by mobile device management | Full App Review against the guidelines below |

The app is never listed publicly and cannot be searched for or downloaded by anyone outside Axxiom.

## Accounts Axxiom must hold first

1. **Apple Developer Program, Organization enrollment.** Needs Axxiom's D-U-N-S number, the legal entity name exactly as Dun and Bradstreet has it, and an officer who can bind the company. Apple verification takes two days to two weeks. $99 a year. **Nothing can be submitted until this exists, so start it first.**
2. **Apple Business Manager.** Also needs the D-U-N-S number, up to five business days. Gives you the Organization ID that a custom app is published to.
3. In the iOS project, put the Apple team identifier in `ios/Configs/Base.xcconfig` as `DEVELOPMENT_TEAM`.

## What has been fixed in the app already

These are the items that cause automatic rejection or a failed upload, and they are done.

| Item | Why Apple cares | State |
|---|---|---|
| App icon, 1024 pixels, no transparency | Upload fails without it | Added: hard hat on navy with a hazard band |
| Privacy manifest (`PrivacyInfo.xcprivacy`) | Required since 2024; the app stores settings, which is a "required reason" API | Added, declaring no tracking, the data collected, and the reason code |
| Microphone and speech purpose strings | Missing or vague strings are rejected | Present and specific |
| No unused permission strings | Reviewers ask why a permission is requested but never used | Face ID string removed until the app lock ships |
| Encryption declaration | Every upload must answer it | Declared exempt, which is correct for plain HTTPS |
| Privacy policy link in the app | Required | Settings shows the link |
| Data and account deletion path | Guideline 5.1.1(v) | Settings explains that Axxiom issues and removes accounts, with a one-tap email to the Safety Manager |
| Medical and emergency wording | Guideline 1.4.1 rejects apps that look like medical advice | The emergency sheet states the steps are quoted from the company manual, are not medical advice, and to call 911 |
| Disclaimer on first launch | Sets expectations for a safety tool | Present, acceptance recorded per user |

## What still has to be done outside the code

**1. Publish the privacy policy.** A draft is at `docs/privacy-policy.md`. Axxiom must host it at a public URL, then that URL goes in two places: App Store Connect, and `PRIVACY_POLICY_URL` in `ios/Configs/Prod.xcconfig`. The app currently points at `axxiomelevator.com/safety-assistant-privacy`, which does not exist yet.

**2. Answer App Privacy in App Store Connect** to match the privacy manifest: email address, user ID and user content (the questions and answers), all linked to the user, all for app functionality, none used for tracking. Disclose that question text is processed by Anthropic to generate answers.

**3. Answer the age rating questionnaire honestly.** It now asks whether the app contains a chatbot or AI-generated content. It does. The answer that matches this app: the assistant only returns text drawn from a single company document, it cannot browse or answer open-ended questions, and every answer is logged and reviewable. Expect a low age rating; a wrong answer here is a common cause of removal later.

**4. Fill in the production configuration.** `ios/Configs/Prod.xcconfig` still has placeholders for the production API host, Supabase project and privacy policy. The app will not work in production until those are real.

**5. Provide a reviewer account.** This is the single most common reason a login-gated app is rejected. In App Store Connect, under App Review Information, tick "Sign-in required" and give a working account. Use a dedicated reviewer account, not the pilot technician account.

**6. Screenshots.** Apple needs three to ten iPhone screenshots. The walkthrough test already produces them; run it and export the images:

```sh
cd ios && xcodebuild test -project AxxiomSafety.xcodeproj -scheme "AxxiomSafety Dev" \
  -destination 'platform=iOS Simulator,name=iPhone 17' -resultBundlePath /tmp/WT.xcresult \
  -only-testing:AxxiomSafetyUITests/WalkthroughTests
xcrun xcresulttool export attachments --path /tmp/WT.xcresult --output-path /tmp/shots
```

Do not use a screenshot that shows an error state, and do not mention Android or the web in any metadata.

## Review notes to paste into App Store Connect

> Axxiom Safety Assistant is an internal tool for Axxiom Elevator's field technicians, distributed only to company-managed iPhones through Apple Business Manager. It is not intended for the public.
>
> The app answers questions using only Axxiom's own Safety and Health Policies manual, which Axxiom wrote and owns. Every answer quotes the policy text and cites the page, and the technician can open that page in the manual, which is bundled and works without a connection. The assistant cannot answer general questions and cannot browse the internet.
>
> The Emergency button quotes emergency steps from the same company manual and directs the user to call 911. It does not provide medical advice or diagnosis, and the app says so on that screen.
>
> Accounts are created and removed by Axxiom; there is no public sign-up. A reviewer account is provided above. The Settings screen explains how an employee requests their data or account deletion.
>
> Answers are generated with Anthropic's Claude API, restricted to the manual text. Questions and answers are retained as safety records so that Axxiom's Safety Manager can review them.

## Guidelines worth knowing about

- **1.4.1 physical harm.** The main risk for this app. Handled by quoting the manual rather than giving advice, by the first-launch disclaimer, and by the wording on the emergency screen.
- **2.1 completeness.** A reviewer who cannot sign in rejects the app. See item 5 above.
- **5.1.1 data collection.** The privacy manifest, the App Privacy answers and the published policy must all agree with each other.
- **5.1.1(v) account deletion.** Apple allows enterprise-managed accounts to be deleted through the company rather than in the app, which is the case here and is explained in Settings and in the review notes.
- **4.8 Sign in with Apple.** Not required, because the app uses Axxiom's own accounts rather than a third-party social login.
- **2.3 accurate metadata.** Do not imply OSHA endorsement or certification anywhere in the app name, subtitle or description. The manual references OSHA standards; the app is not an OSHA product.

## Order of work

1. Start the Apple Developer Program organization enrollment and Apple Business Manager today; they gate everything and are the slowest.
2. Publish the privacy policy and put its URL in the app configuration.
3. Fill in the production configuration and create the production Supabase and Vercel environments.
4. Create the App Store Connect record, answer App Privacy and the age rating, add screenshots and the review notes.
5. Upload a build and run internal TestFlight with the Safety Manager.
6. Submit for Beta App Review and run the pilot.
7. Switch distribution to Private (Custom App), enter Axxiom's Organization ID, and submit for full review.
