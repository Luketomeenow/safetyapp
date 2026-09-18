import XCTest

/// Drives the pilot walkthrough end to end against the staging API and captures a screenshot at
/// each step. Credentials come from the test runner environment (TEST_RUNNER_PILOT_EMAIL/PASSWORD).
final class WalkthroughTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-resetState"]
    }

    /// iOS offers to save the password after a sign-in; the sheet belongs to SpringBoard and blocks taps.
    private func dismissSystemPasswordPrompt() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Not Now", "Not now"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: 8) {
                button.tap()
                return
            }
        }
    }

    private func shoot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testWalkthrough() throws {
        let env = ProcessInfo.processInfo.environment
        let email = env["PILOT_EMAIL"] ?? env["TEST_RUNNER_PILOT_EMAIL"] ?? ""
        let password = env["PILOT_PASSWORD"] ?? env["TEST_RUNNER_PILOT_PASSWORD"] ?? ""
        XCTAssertFalse(email.isEmpty, "PILOT_EMAIL was not passed to the test runner")
        XCTAssertFalse(password.isEmpty, "PILOT_PASSWORD was not passed to the test runner")
        app.launch()

        // 1. Sign in
        let emailField = app.textFields["email-field"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "sign-in screen did not appear")
        shoot("01-sign-in")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields["password-field"]
        passwordField.tap()
        passwordField.typeText(password)
        XCTAssertEqual(emailField.value as? String, email, "email did not type into the field")
        let signIn = app.buttons["sign-in-button"]
        XCTAssertTrue(signIn.isEnabled, "sign-in button stayed disabled, so a field is empty")
        signIn.tap()
        dismissSystemPasswordPrompt()

        // 2. Disclaimer gate
        let accept = app.buttons["accept-disclaimer"]
        XCTAssertTrue(accept.waitForExistence(timeout: 30), "disclaimer did not appear after sign-in")
        shoot("02-disclaimer")
        accept.tap()

        // 3. Chat screen
        let question = app.textFields["question-field"]
        XCTAssertTrue(question.waitForExistence(timeout: 20), "chat screen did not appear")
        shoot("03-chat-empty")

        // 4. Ask a real question
        question.tap()
        question.typeText("When can I use a tag instead of a lock?")
        shoot("04-question-typed")
        app.buttons["send-button"].tap()
        // Either a cited answer or a failure card; both are informative.
        let citation = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] 'Open Program'")).firstMatch
        let failure = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'unavailable' OR label CONTAINS[c] 'offline' OR label CONTAINS[c] 'unexpected error' OR label CONTAINS[c] \"doesn't cover\"")).firstMatch
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline, !citation.exists, !failure.exists {
            usleep(500_000)
        }
        shoot("05-answer")

        // 5. Manual tab: list, then search (works offline)
        dismissSystemPasswordPrompt()
        app.tabBars.buttons["Manual"].tap()
        XCTAssertTrue(app.staticTexts["Ladder and Stairway Safety"].waitForExistence(timeout: 60), "manual programs did not load")
        shoot("06-manual-programs")
        let search = app.searchFields.firstMatch
        search.tap()
        search.typeText("lockout point")
        sleep(2)
        shoot("07-manual-search")

        // 6. Open a search hit in the reader with the passage highlighted
        let firstHit = app.cells.element(boundBy: 1)
        if firstHit.exists {
            firstHit.tap()
            sleep(3)
            shoot("08-manual-reader")
            if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        }

        // 7. Emergency sheet
        if app.buttons["emergency-button"].exists {
            app.buttons["emergency-button"].tap()
        } else {
            app.tabBars.buttons["Chat"].tap()
            app.buttons["emergency-button"].tap()
        }
        XCTAssertTrue(app.buttons["call-911"].waitForExistence(timeout: 10), "emergency sheet did not open")
        shoot("09-emergency")
    }
}
