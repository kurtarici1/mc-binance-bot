const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const express = require("express");

const PORT = 10000;
const app = express();
const bot = new Telegraf(process.env.TG_BOT_TOKEN || "DEFAULT_BOT_TOKEN");
const BASE_URL = "https://api.binance.com/api/v3";
const toplam_islem_sayisi = 0;

const intervals = {
    int_1m: "1m",
    int_3m: "3m",
    int_5m: "5m",
    int_15m: "15m",
    int_30m: "30m",
    int_1h: "1h",
    int_4h: "4h",
    int_12h: "12h",
    int_1d: "1d"
};

async function getPercentageChange(symbol, interval) {
    try {
        const response = await axios.get(`${BASE_URL}/klines`, {
            params: { symbol, interval, limit: 2 }
        });

        const klines = response.data;
        if (!Array.isArray(klines) || klines.length < 2) return null;

        const prevClose = parseFloat(klines[0][4]);
        const currentClose = parseFloat(klines[1][4]);
        if (prevClose === 0) return null;

        return ((currentClose - prevClose) / prevClose) * 100;
    } catch (error) {
        return null;
    }
}

async function findTopGainers(interval) {
    try {
        const info = await axios.get(`${BASE_URL}/exchangeInfo`);
        const symbols = info.data.symbols
            .filter(s => s.status === "TRADING" && (s.symbol.endsWith("USDT") || s.symbol.endsWith("BUSD")))
            .map(s => s.symbol);

        const results = [];

        const promises = symbols.map(sym =>
            getPercentageChange(sym, interval)
                .then(change => {
                    if (change !== null) results.push({ symbol: sym, change });
                })
                .catch(() => { })
        );

        await Promise.all(promises);

        results.sort((a, b) => b.change - a.change);

        return results.slice(0, 10);
    } catch {
        return [];
    }
}

bot.start(ctx => {
    const user = ctx.from;
    const timestamp = new Date().toLocaleString("tr-TR");
    console.log(`🔸 [START KOMUTU] Tarih: ${timestamp} | ID: ${user.id} | Kullanıcı: ${user.first_name} ${user.last_name || ""}`);

    ctx.reply(
        "👋 *Hoş Geldiniz!*\n\n" +
        "📊 Bu bot ile **Binance'daki en çok yükselen coinleri** hızlı şekilde görebilirsiniz.\n\n" +
        "Başlamak için aşağıdaki komutu kullanın:\n" +
        "➡️ */binance*\n\n" +
        "Her zaman yardım için buradayım! 🚀",
        {
            parse_mode: "Markdown",
            reply_markup: {
                remove_keyboard: true
            }
        }
    );
});

bot.command("binance", ctx => {
    const user = ctx.from;
    const timestamp = new Date().toLocaleString("tr-TR");
    console.log(`🔸 [BINANCE KOMUTU] Tarih: ${timestamp} | ID: ${user.id} | Kullanıcı: ${user.first_name} ${user.last_name || ""}`);

    ctx.reply(
        "⏱ *Hangi süreye göre analiz yapılsın?*",
        {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback("Son 1 dakika", "int_1m"),
                    Markup.button.callback("Son 3 dakika", "int_3m"),
                    Markup.button.callback("Son 5 dakika", "int_5m")
                ],
                [
                    Markup.button.callback("Son 15 dakika", "int_15m"),
                    Markup.button.callback("Son 30 dakika", "int_30m"),
                    Markup.button.callback("Son 1 saat", "int_1h")
                ],
                [
                    Markup.button.callback("Son 4 saat", "int_4h"),
                    Markup.button.callback("Son 12 saat", "int_12h"),
                    Markup.button.callback("Son 1 gün", "int_1d"),
                ]
            ])
        }
    );
});

for (const key in intervals) {
    bot.action(key, async ctx => {
        const user = ctx.from;
        const timestamp = new Date().toLocaleString("tr-TR");
        const interval = intervals[key];
        const intervalT = interval;

        if (!intervalT.startsWith("Son ")) {
            if (intervalT.endsWith("m")) {
                intervalT = "Son " + intervalT.slice(0, -1) + " dakika";
            } else if (intervalT.endsWith("h")) {
                intervalT = "Son " + intervalT.slice(0, -1) + " saat";
            } else if (intervalT.endsWith("d")) {
                intervalT = "Son " + intervalT.slice(0, -1) + " gün";
            }
        }

        console.log(`🔹 [INTERVAL SEÇİMİ] Tarih: ${timestamp} | ID: ${user.id} | Kullanıcı: ${user.first_name} ${user.last_name || ""} | Seçilen interval: ${intervalT}`);

        try {
            await ctx.answerCbQuery("⏳ Hesaplama başladı...", true);
        } catch { }

        let loadingMessage;
        try {
            loadingMessage = await ctx.reply(
                `🔍 *${intervalT}* için yükselen coinler analiz ediliyor...\n\n` +
                `Lütfen birkaç saniye bekleyin. 🚀`,
                { parse_mode: "Markdown" }
            );
        } catch {
            return;
        }

        const top = await findTopGainers(interval);
        let message;

        if (top.length === 0) {
            message = `⚠️ *${intervalT}* için veri alınamadı.\n\nDaha sonra tekrar deneyin.`;
        } else {
            message =
                `📈 *${intervalT} içindeki en çok yükselen coinler:*\n\n` +
                top.map((item, i) =>
                    `${i + 1}. *${item.symbol}*: ${item.change.toFixed(2)}% 📊`
                ).join("\n");
        }

        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMessage.message_id,
                null,
                message,
                { parse_mode: "Markdown" }
            );
        } catch {
            try {
                await ctx.reply(message, { parse_mode: "Markdown" });
            } catch { }
        }

        toplam_islem_sayisi++;

        console.log(`🔹 [SONUÇLAR GÖSTERİLDİ] Tarih: ${timestamp} | ID: ${user.id} | Kullanıcı: ${user.first_name} ${user.last_name || ""} | Interval: ${intervalT}`);
        console.log(`⭐ Toplam işlem sayısı \x1b[1m\x1b[32m${toplam_islem_sayisi}\x1b[0m oldu.`);
    });
}

async function startBot() {
    try { await bot.telegram.deleteWebhook(); } catch { }
    bot.catch(() => { });
    bot.launch();

    app.get("/", (req, res) => res.send("MC Binance Bot Telegram üzerinde aktif."));
    app.listen(PORT, () => {
        console.log('🤖 MC Binance Telegram Bot Aktif.');
        console.log(`🌐 Web Port Dinleme Aktif : ${PORT}`);
    });
}

startBot();
