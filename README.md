# YOPI ON AIR — Key System Setup Guide

## Stack
- **Backend:** Node.js + Express + SQLite
- **Bot:** Discord.js v14
- **Host:** Railway (free tier)

---

## STEP 1 — Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it `Yopi On Air`
3. Go to **Bot** tab → click **Add Bot**
4. Copy the **Token** (you'll need it)
5. Enable **Message Content Intent** under Privileged Gateway Intents
6. Go to **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Manage Roles`, `Read Message History`
7. Copy the generated URL and invite the bot to your server

---

## STEP 2 — Deploy to Railway

1. Go to https://railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
   - Or use **Deploy from template → Node.js**
3. Upload these files:
   - `index.js`
   - `package.json`
4. Go to **Variables** tab and add:

```
BOT_TOKEN         = your bot token
GUILD_ID          = your server ID (right-click server → Copy ID)
KEY_CHANNEL_ID    = channel ID for the panel
SCRIPT_ROLE_ID    = role ID for verified users
ADMIN_USER_ID     = your Discord user ID
SCRIPT_URL        = URL to your YopiOnAir.lua (GitHub raw link)
```

5. Railway will give you a URL like `https://your-app.railway.app`

---

## STEP 3 — Post the Panel

In your Discord server, type:
```
!panel
```
The bot will post the key management panel with all buttons.

---

## STEP 4 — Add Key Validation to your Script

1. Open `KeyValidation.lua`
2. Change `API_URL` to your Railway URL:
   ```lua
   local API_URL = "https://your-app.railway.app"
   ```
3. Paste the content of `KeyValidation.lua` at the TOP of `YopiOnAir.lua`
4. Wrap your existing script code inside `runWithKeyCheck(function() ... end)`

---

## How it works

1. User clicks **Get Key** → bot generates a key with 30s cooldown
2. User redeems with `/redeem YOPI-XXXXXX-XXXXXX-XXXXXX` in chat
3. Bot gives them the **Script Role** automatically
4. User runs the script → key prompt appears → enters key
5. Backend validates key + binds HWID on first use
6. Script loads ✓

## Admin Commands
- `!panel` — posts/refreshes the key panel
- `!genkey` — generates a 30-day admin key (sent to your DMs)

---

## Key Format
```
YOPI-A1B2C3-D4E5F6-G7H8I9
```
