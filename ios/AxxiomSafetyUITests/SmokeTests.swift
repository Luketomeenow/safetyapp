import XCTest

final class SmokeTests: XCTestCase {
    func testLaunchShowsSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-resetState"]
        app.launch()
        XCTAssertTrue(app.buttons["sign-in-button"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.textFields["email-field"].exists)
    }
}
