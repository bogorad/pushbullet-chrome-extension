# Pushbullet for Chrome (Unofficial, Manifest V3)

An unofficial Chrome extension for Pushbullet that uses Manifest V3 to replace the original extension which is no longer compatible with recent Chrome versions. This version includes security improvements, UI enhancements, and cross-browser token syncing.

**DISCLAIMER: This extension is not affiliated with, endorsed by, or connected to Pushbullet Inc. in any way. This is an independent, community-developed project.**

## Features

- Send notes and links to your devices
- View recent pushes
- Receive notifications for incoming pushes
- Context menu integration for quickly pushing links, text, and images
- Real-time updates using WebSocket
- Auto-open links when received (can be disabled)
- Registers as a "Chrome" device in your Pushbullet account
- Cross-browser token syncing (via Chrome sync)
- Improved UI with button-based push type selection
- Auto-populate link fields with current tab URL and title
- Secure API key storage with basic obfuscation
- No external dependencies
- Manifest V3 compliant

## Requirements

- Chrome browser (version 88+ for Manifest V3 support)
- Pushbullet account with Access Token
- Internet connection for API communication

## Installation

### From the Chrome Web Store
(Coming soon)

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" at the top-right
4. Click "Load unpacked" and select the folder containing this extension
5. The extension should now be installed and visible in your Chrome toolbar

### Permissions Required

The extension requires the following permissions:
- `storage`: For storing your Access Token and settings
- `notifications`: For displaying push notifications
- `tabs`: For auto-populating link fields with current tab info
- `contextMenus`: For right-click push functionality
- Host permission for `https://api.pushbullet.com/*`: For API communication

## Usage

1. Click on the extension icon in the toolbar
2. Enter your Pushbullet Access Token (you can find this in your [Pushbullet account settings](https://www.pushbullet.com/#settings/account) under Access Tokens)
3. Once authenticated, you can:
    - Send notes or links to your devices (use Note/Link buttons for easy switching)
    - View your recent pushes
    - See your connected devices
    - Configure settings like auto-opening links and device nickname
4. Your token will sync across browsers signed into the same Google account

### Push Type Selection
- Click "Note" to send text notes
- Click "Link" to send links (auto-populates with current tab's URL and title)

### Context Menu Features

Right-click on the following to send them via Pushbullet:
- Links: Sends the link URL
- Selected text: Sends the text as a note
- Images: Sends the image URL as a link

### Real-time Updates

The extension maintains a WebSocket connection to Pushbullet's servers to receive real-time updates when new pushes are received. This ensures you always see the latest pushes without having to refresh.

### Auto-open Links

When enabled (default), links sent directly to your Chrome device will automatically open in a new tab. You can disable this feature in the extension's settings.

### Cross-Browser Syncing

Your Access Token and settings sync automatically across Chrome browsers signed into the same Google account. Changes made in one browser will appear in others after a short sync delay.

## Troubleshooting

### Extension Not Loading
- Ensure you're using Chrome version 88 or later
- Try reloading the extension in `chrome://extensions`
- Check the console for any errors

### Authentication Issues
- Verify your Access Token is correct in your Pushbullet account settings
- Try logging out and re-entering the token
- Check network connectivity

### Sync Not Working
- Ensure you're signed into Chrome with the same Google account
- Wait a few minutes for sync to propagate
- Check Chrome's sync settings

### WebSocket Connection Issues
- The extension maintains a persistent WebSocket connection for real-time updates
- If connections fail, it will automatically retry
- Check your internet connection

### Permission Errors
- Re-install the extension to grant required permissions
- Check that all required permissions are enabled in `chrome://extensions`

## Privacy

This extension only communicates with the official Pushbullet API. Your Access Token is stored securely in Chrome's storage (with basic obfuscation) and syncs across your browsers via Chrome's built-in sync feature. It is not sent anywhere except to the Pushbullet servers for authentication and API calls.

No data is collected by this extension or sent to any third parties.

## Security Considerations

- Your Pushbullet Access Token provides full access to your Pushbullet account
- This extension stores your Access Token securely in Chrome's storage with basic obfuscation
- Token syncing uses Chrome's built-in sync feature (encrypted)
- WebSocket connections use secure protocols
- Always review the code before installing any extension that requires Access Tokens
- The extension follows Manifest V3 security best practices

## License

MIT

## Credits

Created as an independent alternative to the original Pushbullet extension which is not compatible with Chrome's Manifest V3 requirements. Pushbullet and its logo are trademarks of Pushbullet Inc.

## Development

### Project Structure
- `manifest.json`: Extension manifest (Manifest V3)
- `popup.html/js/popup.js`: Extension popup interface
- `background.js`: Background service worker for API calls and WebSocket
- `css/popup.css`: Popup styling
- `js/`: JavaScript files
- `icons/`: Extension icons

### Building and Testing
1. Load the extension unpacked as described in Installation
2. Make changes to the code
3. Reload the extension in `chrome://extensions`
4. Test functionality

### Code Style
- Uses modern JavaScript (ES6+)
- Follows Chrome Extension best practices
- Includes basic error handling and logging

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Focus areas:
- UI/UX improvements
- Additional features
- Bug fixes and security enhancements
- Code optimization 
