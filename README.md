# Pushbullet for Chrome (Unofficial)

A Manifest V3 compatible Chrome extension for Pushbullet. This extension allows you to receive and send pushes, view mirrored notifications, and interact with your Pushbullet account directly from your browser.

> This project is not affiliated with, endorsed by, or connected to Pushbullet Inc.

---

## Installation

1.  Download the extension files or clone this repository to your local machine.
2.  Open the Google Chrome browser and navigate to `chrome://extensions`.
3.  Enable "Developer mode" using the toggle switch in the top-right corner of the page.
4.  Click the "Load unpacked" button that appears on the top-left.
5.  In the file selection dialog, navigate to and select the root directory of this repository.
6.  The extension is now installed. Click the new Pushbullet icon in your browser's toolbar.
7.  Paste your Access Token from your [Pushbullet Account Settings](https://www.pushbullet.com/#settings/account) and provide a nickname for your browser to complete the setup.

---

## Usage

The extension provides several ways to interact with your Pushbullet account.

| Feature | Description |
| :--- | :--- |
| **Toolbar Pop-up** | Click the extension icon in the toolbar to open the main interface. From here, you can send notes, links, or files, and view your 10 most recent pushes. |
| **Context Menu** | Right-click on a webpage, a link, an image, or selected text to open the context menu. You will find options to instantly push the selected content. |
| **Notifications** | Incoming pushes from your devices will appear as native system notifications. Clicking a notification will open its content. |
| **Auto-Open Links** | In the extension's options, you can enable a setting to have incoming link pushes automatically open in a new, non-focused browser tab. |

---

## Building from Source

If you wish to build the extension from the source code yourself, follow these steps.

1.  **Prerequisites**
    *   Node.js and npm must be installed on your system.

2.  **Build Steps**
    1.  Open a terminal or command prompt in the project's root directory.
    2.  Install the required dependencies by running:
        ```bash
        npm install
        ```
    3.  Compile the TypeScript source code into JavaScript by running:
        ```bash
        npm run build
        ```
        This will create the necessary files in the `dist/` directory.

3.  **Run Tests (Optional)**
    *   You can run the suite of unit tests to verify functionality:
        ```bash
        npm test
        ```

4.  **Load the Extension**
    *   After building, follow the steps outlined in the **Installation** section to load the extension into Chrome.