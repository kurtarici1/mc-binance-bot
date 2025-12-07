const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const express = require("express");

const app = express();
const bot = new Telegraf(process.env.TG_BOT_TOKEN || "DEFAULT_BOT_TOKEN");
const BASE_URL = "https://api.binance.com/api/v3";

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
                .catch(() => {})
        );

        await Promise.all(promises);

        results.sort((a, b) => b.change - a.change);

        return results.slice(0, 10);
    } catch {
        return [];
    }
}

bot.start(ctx => {
    ctx.reply(
        "📊 *MC Binance Bot*\n\nHoşgeldiniz!\n/binance komutu ile en çok yükselen coinleri görebilirsiniz.",
        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
    );
});

bot.command("binance", ctx => {
    ctx.reply(
        "⏱ *Hangi süreye göre analiz yapılsın?*",
        {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback("1 dakika", "int_1m"),
                    Markup.button.callback("5 dakika", "int_5m")
                ],
                [
                    Markup.button.callback("15 dakika", "int_15m"),
                    Markup.button.callback("30 dakika", "int_30m")
                ],
                [
                    Markup.button.callback("1 saat", "int_1h")
                ]
            ])
        }
    );
});

const intervals = {
    int_1m: "1m",
    int_5m: "5m",
    int_15m: "15m",
    int_30m: "30m",
    int_1h: "1h"
};

let istek_sayisi = 0;

for (const key in intervals) {
    bot.action(key, async ctx => {
        try { await ctx.answerCbQuery('Hesaplanıyor...', true); } catch {}

        const interval = intervals[key];
        const intervalT = interval.replace("m", " dakika").replace("h", " saat");

        let loadingMessage;
        try {
            loadingMessage = await ctx.reply(`⏳ *${intervalT}* analiz ediliyor...`, { parse_mode: "Markdown" });
        } catch {
            return;
        }

        const top = await findTopGainers(interval);

        let message;
        if (top.length === 0) {
            message = `⚠️ *${intervalT}* için veri alınamadı.`;
        } else {
            message = `📈 *${intervalT} içindeki en çok yükselen coinler:*\n\n`;
            top.forEach((item, i) => {
                message += `${i + 1}. *${item.symbol}*: ${item.change.toFixed(2)}%\n`;
            });
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
            try { await ctx.reply(message, { parse_mode: "Markdown" }); } catch {}
        }

        istek_sayisi++;
        console.log("İstek sayısı:", istek_sayisi);
    });
}

async function startBot() {
    try { await bot.telegram.deleteWebhook(); } catch {}
    bot.catch(() => {});
    bot.launch();
    console.log("Bot çalışıyor...");
}

const PORT = 10000;

app.get("/", (req, res) => res.send("MC Binance Bot Telegram üzerinde aktif."));
app.listen(PORT, () => {
    console.log("Port dinleme başlatıldı: " + PORT);
});

startBot();
