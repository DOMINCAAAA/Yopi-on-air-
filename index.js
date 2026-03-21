// ╔══════════════════════════════════════════╗
// ║      YOPI ON AIR — Key System Backend    ║
// ║   Node.js + SQLite · Deploy on Railway   ║
// ╚══════════════════════════════════════════╝

require("dotenv").config();
const express    = require("express");
const Database   = require("better-sqlite3");
const { Client, GatewayIntentBits, EmbedBuilder,
        ActionRowBuilder, ButtonBuilder, ButtonStyle,
        PermissionFlagsBits } = require("discord.js");
const crypto     = require("crypto");
const path       = require("path");
const fs         = require("fs");

const app = express();
app.use(express.json());

// ════════════════════════════════════════════
// CONFIG  (set these in Railway environment variables)
// ════════════════════════════════════════════
const BOT_TOKEN      = process.env.BOT_TOKEN;
const GUILD_ID       = process.env.GUILD_ID;
const KEY_CHANNEL_ID = process.env.KEY_CHANNEL_ID;   // channel where bot posts key panel
const SCRIPT_ROLE_ID = process.env.SCRIPT_ROLE_ID;   // role given on redeem
const ADMIN_USER_ID  = process.env.ADMIN_USER_ID;    // your Discord user ID
const PORT           = process.env.PORT || 3000;
const KEY_COOLDOWN   = 30 * 1000;                    // 30 seconds between key generations
const SCRIPT_URL     = process.env.SCRIPT_URL || "https://your-script-url.com/YopiOnAir.lua";

// ════════════════════════════════════════════
// DATABASE
// ════════════════════════════════════════════
const db = new Database("yopi_keys.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
        key         TEXT PRIMARY KEY,
        user_id     TEXT,
        hwid        TEXT,
        redeemed    INTEGER DEFAULT 0,
        redeemed_at INTEGER,
        created_at  INTEGER DEFAULT (strftime('%s','now')),
        expires_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
        user_id     TEXT PRIMARY KEY,
        last_get    INTEGER
    );

    CREATE TABLE IF NOT EXISTS stats (
        user_id     TEXT PRIMARY KEY,
        keys_gotten INTEGER DEFAULT 0,
        redeems     INTEGER DEFAULT 0,
        hwid_resets INTEGER DEFAULT 0
    );
`);

// ════════════════════════════════════════════
// KEY HELPERS
// ════════════════════════════════════════════
function generateKey() {
    const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
    return `YOPI-${seg()}-${seg()}-${seg()}`;
}

function getOrCreateStats(userId) {
    let row = db.prepare("SELECT * FROM stats WHERE user_id=?").get(userId);
    if (!row) {
        db.prepare("INSERT INTO stats (user_id) VALUES (?)").run(userId);
        row = db.prepare("SELECT * FROM stats WHERE user_id=?").get(userId);
    }
    return row;
}

function incrementStat(userId, field) {
    db.prepare(`UPDATE stats SET ${field} = ${field} + 1 WHERE user_id=?`).run(userId);
}

// ════════════════════════════════════════════
// EXPRESS API  (called from Lua script to validate)
// ════════════════════════════════════════════

// Validate key + HWID binding
app.post("/validate", (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.json({ valid: false, reason: "Missing key or hwid" });

    const row = db.prepare("SELECT * FROM keys WHERE key=?").get(key);
    if (!row)            return res.json({ valid: false, reason: "Invalid key" });
    if (!row.redeemed)   return res.json({ valid: false, reason: "Key not redeemed yet" });
    if (row.expires_at && row.expires_at < Math.floor(Date.now()/1000))
                         return res.json({ valid: false, reason: "Key expired" });

    // First use: bind HWID
    if (!row.hwid) {
        db.prepare("UPDATE keys SET hwid=? WHERE key=?").run(hwid, key);
        return res.json({ valid: true });
    }

    if (row.hwid !== hwid) return res.json({ valid: false, reason: "HWID mismatch" });

    return res.json({ valid: true });
});

// Health check
app.get("/", (req, res) => res.send("Yopi On Air Key System · Online"));

// ════════════════════════════════════════════
// DISCORD BOT
// ════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
    ],
});

// ── Build the main panel embed + buttons ──
function buildPanel() {
    const embed = new EmbedBuilder()
        .setTitle("Auto Joiner Key Management")
        .setDescription("Manage your keys and scripts easily using the buttons below.")
        .setThumbnail("https://i.imgur.com/AfFp7pu.png")
        .addFields(
            { name: "Available Functions", value:
                "**Get Key** → Generate a new key *(30s cooldown)*\n" +
                "**Redeem Key** → Redeem an existing key\n" +
                "**Get Script** → Download the Lua script\n" +
                "**Phone Users** → Receive the script via DM\n" +
                "**Get Role** → Obtain your Discord role\n" +
                "**Reset HWID** → Reset your hardware ID\n" +
                "**Get Stats** → View your key statistics"
            },
            { name: "Provider", value: "Yopi On Air" }
        )
        .setImage("https://i.imgur.com/AfFp7pu.png")
        .setFooter({ text: "Key Management System • Yopi On Air" })
        .setColor(0x5865F2);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("get_key")    .setLabel("Get Key")     .setStyle(ButtonStyle.Primary)  .setEmoji("🔑"),
        new ButtonBuilder().setCustomId("redeem_key") .setLabel("Redeem Key")  .setStyle(ButtonStyle.Secondary).setEmoji("📋"),
        new ButtonBuilder().setCustomId("get_script") .setLabel("Get Script")  .setStyle(ButtonStyle.Secondary).setEmoji("📥"),
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("get_role")   .setLabel("Get Role")    .setStyle(ButtonStyle.Secondary).setEmoji("🏷️"),
        new ButtonBuilder().setCustomId("reset_hwid") .setLabel("Reset HWID")  .setStyle(ButtonStyle.Danger)   .setEmoji("🔄"),
        new ButtonBuilder().setCustomId("get_stats")  .setLabel("Get Stats")   .setStyle(ButtonStyle.Secondary).setEmoji("📊"),
    );

    return { embeds: [embed], components: [row1, row2] };
}

// ── Post / refresh panel ──
async function postPanel() {
    const channel = await client.channels.fetch(KEY_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    // Delete old panel messages
    const msgs = await channel.messages.fetch({ limit: 10 });
    for (const [, msg] of msgs) {
        if (msg.author.id === client.user.id) await msg.delete().catch(() => {});
    }

    await channel.send(buildPanel());
}

// ── Button interactions ──
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const id     = interaction.customId;

    // ── GET KEY ──────────────────────────────────
    if (id === "get_key") {
        const cooldownRow = db.prepare("SELECT last_get FROM cooldowns WHERE user_id=?").get(userId);
        const now = Date.now();

        if (cooldownRow && (now - cooldownRow.last_get) < KEY_COOLDOWN) {
            const remaining = Math.ceil((KEY_COOLDOWN - (now - cooldownRow.last_get)) / 1000);
            return interaction.reply({
                content: `⏳ Please wait **${remaining}s** before generating a new key.`,
                ephemeral: true,
            });
        }

        const key = generateKey();
        const expiresAt = Math.floor(Date.now()/1000) + 86400; // 24h

        db.prepare("INSERT INTO keys (key, user_id, expires_at) VALUES (?,?,?)").run(key, userId, expiresAt);
        db.prepare("INSERT OR REPLACE INTO cooldowns (user_id, last_get) VALUES (?,?)").run(userId, now);
        incrementStat(userId, "keys_gotten");

        const embed = new EmbedBuilder()
            .setTitle("🔑 Your Key")
            .setDescription(`\`\`\`\n${key}\n\`\`\``)
            .addFields({ name: "Expires", value: `<t:${expiresAt}:R>`, inline: true })
            .setColor(0x57F287)
            .setFooter({ text: "Yopi On Air • Key System" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── REDEEM KEY ───────────────────────────────
    if (id === "redeem_key") {
        return interaction.reply({
            content: "📋 Please type your key in this format:\n`/redeem YOPI-XXXXXX-XXXXXX-XXXXXX`\n\nOr DM the bot with your key.",
            ephemeral: true,
        });
    }

    // ── GET SCRIPT ───────────────────────────────
    if (id === "get_script") {
        // Check if user has a redeemed key
        const row = db.prepare("SELECT * FROM keys WHERE user_id=? AND redeemed=1").get(userId);
        if (!row) {
            return interaction.reply({
                content: "❌ You need to redeem a key first!",
                ephemeral: true,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("📥 Download Script")
            .setDescription(`[**Click here to download YopiOnAir.lua**](${SCRIPT_URL})`)
            .setColor(0x5865F2)
            .setFooter({ text: "Yopi On Air • Keep your key private!" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── PHONE USERS (DM script) ──────────────────
    if (id === "phone_users") {
        const row = db.prepare("SELECT * FROM keys WHERE user_id=? AND redeemed=1").get(userId);
        if (!row) {
            return interaction.reply({ content: "❌ Redeem a key first!", ephemeral: true });
        }

        try {
            const dm = await interaction.user.createDM();
            await dm.send({
                content: `📱 **Yopi On Air Script**\n\nHere is your script link:\n${SCRIPT_URL}\n\n*Keep this private!*`
            });
            return interaction.reply({ content: "✅ Script sent to your DMs!", ephemeral: true });
        } catch {
            return interaction.reply({ content: "❌ Couldn't DM you. Enable DMs from server members.", ephemeral: true });
        }
    }

    // ── GET ROLE ─────────────────────────────────
    if (id === "get_role") {
        const row = db.prepare("SELECT * FROM keys WHERE user_id=? AND redeemed=1").get(userId);
        if (!row) {
            return interaction.reply({ content: "❌ Redeem a key first!", ephemeral: true });
        }

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.reply({ content: "❌ Could not find you in the server.", ephemeral: true });

        if (member.roles.cache.has(SCRIPT_ROLE_ID)) {
            return interaction.reply({ content: "✅ You already have the role!", ephemeral: true });
        }

        await member.roles.add(SCRIPT_ROLE_ID).catch(() => {});
        return interaction.reply({ content: "✅ Role granted!", ephemeral: true });
    }

    // ── RESET HWID ───────────────────────────────
    if (id === "reset_hwid") {
        const row = db.prepare("SELECT * FROM keys WHERE user_id=? AND redeemed=1").get(userId);
        if (!row) {
            return interaction.reply({ content: "❌ No redeemed key found.", ephemeral: true });
        }

        db.prepare("UPDATE keys SET hwid=NULL WHERE user_id=? AND redeemed=1").run(userId);
        incrementStat(userId, "hwid_resets");

        return interaction.reply({
            content: "✅ HWID reset! Your key will bind to the next device that uses it.",
            ephemeral: true,
        });
    }

    // ── GET STATS ────────────────────────────────
    if (id === "get_stats") {
        const stats = getOrCreateStats(userId);
        const keys  = db.prepare("SELECT * FROM keys WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(userId);

        const embed = new EmbedBuilder()
            .setTitle("📊 Your Stats")
            .setColor(0x5865F2)
            .addFields(
                { name: "Keys Generated",  value: `\`${stats.keys_gotten}\``,  inline: true },
                { name: "Keys Redeemed",   value: `\`${stats.redeems}\``,      inline: true },
                { name: "HWID Resets",     value: `\`${stats.hwid_resets}\``,  inline: true },
                { name: "Latest Key",      value: keys ? `\`${keys.key}\`` : "None", inline: false },
                { name: "Key Status",      value: keys ? (keys.redeemed ? "✅ Redeemed" : "⏳ Pending") : "None", inline: true },
                { name: "HWID Bound",      value: keys?.hwid ? "🔒 Yes" : "🔓 No", inline: true },
            )
            .setFooter({ text: "Yopi On Air • Key System" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ── Message-based redeem: user types the key in chat ──
client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    // /redeem YOPI-XXXXXX-XXXXXX-XXXXXX
    const match = msg.content.match(/\/redeem\s+(YOPI-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+)/i);
    if (!match) return;

    const key    = match[1].toUpperCase();
    const userId = msg.author.id;
    const row    = db.prepare("SELECT * FROM keys WHERE key=?").get(key);

    // Delete message for security
    await msg.delete().catch(() => {});

    if (!row) {
        return msg.author.send("❌ Invalid key.").catch(() => {});
    }
    if (row.redeemed) {
        return msg.author.send("❌ Key already redeemed.").catch(() => {});
    }
    if (row.expires_at && row.expires_at < Math.floor(Date.now()/1000)) {
        return msg.author.send("❌ Key has expired.").catch(() => {});
    }

    db.prepare("UPDATE keys SET redeemed=1, user_id=?, redeemed_at=strftime('%s','now') WHERE key=?")
      .run(userId, key);
    incrementStat(userId, "redeems");

    // Give role
    const guild  = client.guilds.cache.get(GUILD_ID);
    const member = guild && await guild.members.fetch(userId).catch(() => null);
    if (member && SCRIPT_ROLE_ID) {
        await member.roles.add(SCRIPT_ROLE_ID).catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setTitle("✅ Key Redeemed!")
        .setDescription(`Your key \`${key}\` has been successfully redeemed.`)
        .addFields(
            { name: "Script", value: `[Download here](${SCRIPT_URL})`, inline: true },
        )
        .setColor(0x57F287)
        .setFooter({ text: "Yopi On Air • Welcome!" });

    msg.author.send({ embeds: [embed] }).catch(() => {});
});

// ── Admin command: !panel ──
client.on("messageCreate", async (msg) => {
    if (msg.author.id !== ADMIN_USER_ID) return;
    if (msg.content === "!panel") {
        await postPanel();
        msg.reply("✅ Panel posted!").then(m => setTimeout(() => m.delete().catch(()=>{}), 3000));
    }
    if (msg.content === "!genkey") {
        const key = generateKey();
        db.prepare("INSERT INTO keys (key, expires_at) VALUES (?,?)")
          .run(key, Math.floor(Date.now()/1000) + 86400*30);
        msg.author.send(`🔑 Admin key: \`${key}\``).catch(()=>{});
        msg.delete().catch(()=>{});
    }
});

// ════════════════════════════════════════════
// START
// ════════════════════════════════════════════
jsclient.once("ready", async () => {
  console.log(`[Yopi On Air] Bot ready as ${client.user.tag}`);
  console.log(`[Yopi On Air] Key System running on port ${PORT}`);

  const channel = await client.channels.fetch(KEY_CHANNEL_ID).catch(() => null);
  if (channel) {
    await postPanel(channel);
    console.log(`[Yopi On Air] Panel posted to channel.`);
  } else {
    console.log(`[Yopi On Air] ERROR: Could not find channel ${KEY_CHANNEL_ID}`);
  }
});

client.login(BOT_TOKEN);
app.listen(PORT, () => console.log(`[API] Listening on :${PORT}`));
