# Pushbullet for Chrome (Unofficial, Manifest V3)

> [!WARNING]
> This extension was vibe-coded on the jurassic models and tooling of 4mo ago and just barely worked well enough for my needs. I'm pretty sure the current generation can do a better job of writing it from scratch. I'm not using it anymore, and won't be maintaining it, so, if you need it, I encourage you to prompt yourself a new one.

An unofficial Chrome extension for Pushbullet that uses Manifest V3 to replace the original extension which is no longer compatible with recent Chrome versions.

**DISCLAIMER: This extension is not affiliated with, endorsed by, or connected to Pushbullet Inc. in any way. This is an independent, community-developed project.**

## Features

- Send notes and links to your devices
- View recent pushes
- Receive notifications for incoming pushes
- Context menu integration for quickly pushing links, text, and images
- Real-time updates using WebSocket
- Auto-open links when received (can be disabled)
- Registers as a "Chrome" device in your Pushbullet account
- No external dependencies

## Installation

### From the Chrome Web Store
(Coming soon)

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" at the top-right
4. Click "Load unpacked" and select the folder containing this extension
5. The extension should now be installed and visible in your Chrome toolbar

## Usage

1. Click on the extension icon in the toolbar
2. Enter your Pushbullet Access Token (you can find this in your [Pushbullet account settings](https://www.pushbullet.com/#settings/account) under Access Tokens)
3. Once authenticated, you can:
   - Send notes or links to your devices
   - View your recent pushes
   - See your connected devices
   - Configure settings like auto-opening links

### Context Menu Features

Right-click on the following to send them via Pushbullet:
- Links: Sends the link URL
- Selected text: Sends the text as a note
- Images: Sends the image URL as a link

### Real-time Updates

The extension maintains a WebSocket connection to Pushbullet's servers to receive real-time updates when new pushes are received. This ensures you always see the latest pushes without having to refresh.

### Auto-open Links

When enabled (default), links sent directly to your Chrome device will automatically open in a new tab. You can disable this feature in the extension's settings.

## Privacy

This extension only communicates with the official Pushbullet API. Your Access Token is stored locally in your browser and is not sent anywhere except to the Pushbullet servers for authentication and API calls.

No data is collected by this extension or sent to any third parties.

## Security Considerations

- Your Pushbullet Access Token provides full access to your Pushbullet account
- This extension stores your Access Token locally in Chrome's secure storage
- Always review the code before installing any extension that requires Access Tokens

## License

MIT

## Credits

Created as an independent alternative to the original Pushbullet extension which is not compatible with Chrome's Manifest V3 requirements. Pushbullet and its logo are trademarks of Pushbullet Inc.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 
