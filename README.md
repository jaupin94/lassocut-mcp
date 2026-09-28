# LassoCut MCP

Remove image backgrounds from your AI assistant with a [LassoCut](https://www.lassocut.com/) account. The API is compatible with the remove.bg API.

## What it does

Ask Claude (or any MCP-compatible assistant) to cut out product photos, portraits, whole folders, or images from a URL. Results are saved next to the originals as `<name>-no-bg.<ext>` and existing files are never overwritten — a name already taken gets `-2`, `-3`, and so on instead.

By default, every image is processed as a low-cost **preview** (0.25 credit, 50 free per month). Full-size output costs 1 credit per image and is only used when you explicitly ask for it; above 10 full-size images, the assistant must show you the cost and get your OK first.

## Install

**Claude Desktop:** download [`lassocut.mcpb`](https://github.com/jaupin94/lassocut-mcp/releases/latest/download/lassocut.mcpb) and double-click it.

**Claude Code:**

```bash
claude mcp add lassocut -- npx -y lassocut-mcp
```

**Cursor / Windsurf** (or any other MCP client that reads a JSON config):

```json
{ "mcpServers": { "lassocut": { "command": "npx", "args": ["-y", "lassocut-mcp"] } } }
```

Requires Node.js 20 or later.

## Sign in

You need a LassoCut account and API key. Three ways to connect:

1. Ask the assistant to **sign in**. It calls the `sign_in` tool, which opens the LassoCut approval page in your browser and returns the approval link and a short code right away. Approve the connection in the browser, then ask the assistant to check your credits (`get_credits`) — the key is saved automatically in the background (the approval window stays open for a few minutes).
2. Already signed in with the [`lassocut` command-line tool](https://www.lassocut.com/)? This connector reads the same saved key from `lassocut login`, so no extra step is needed.
3. Set the `LASSOCUT_API_KEY` environment variable (or the `api_key` field in Claude Desktop's extension settings) to a key from your [LassoCut account page](https://www.lassocut.com/account/). This always takes precedence over a signed-in key.

## Tools

### `remove_background`

Remove the background of one or more images.

| Parameter | Description |
| --- | --- |
| `images` | A file path, a folder path (its images, not subfolders), an `http(s)` URL, or a list of any of these. Up to 50 per call. |
| `size` | `preview` (default) or `full`. |
| `background` | `transparent` (default), a hex color such as `#ffffff`, or a color name. |
| `format` | `png` (default), `jpg`, or `webp`. |
| `crop` | Crop the result to the subject. |
| `output_dir` | Where to save results. Must be an absolute path (`~` is expanded). If omitted: next to each original file, or your Downloads folder (falling back to your home folder) for images fetched from a URL. |
| `confirm_cost` | Set to `true` only after the user has confirmed the cost of a full-size request over 10 images. |

Files larger than 22 MB are skipped. Up to 3 small thumbnails are returned inline with the result.

### `get_credits`

Shows your current credit balance and the free previews left this month.

### `sign_in`

Connects a LassoCut account: opens the approval page in your browser and returns immediately with the link and code so you can approve at your own pace. Pass `force: true` to switch to a different account.

## Credits and safety

- Previews are the default everywhere; full-size output is never used unless asked for.
- Requesting full size for more than 10 images at once requires an explicit confirmation, with the cost shown up front.
- If your balance is too low for a full-size request, it is refused before any image is sent.
- Files are only ever sent to the LassoCut API — see Privacy below.

## Privacy

Images are sent only to the LassoCut API to remove their background; they are not sent anywhere else. See the [LassoCut privacy policy](https://www.lassocut.com/legal/privacy/) for details.

---

remove.bg is a trademark of Canva Austria GmbH. LassoCut is an independent product of JAUPIN Design LLC and is not affiliated with, endorsed by, or sponsored by Canva or remove.bg.

## License

MIT — see [LICENSE](./LICENSE).
