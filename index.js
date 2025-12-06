const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const bot = new Telegraf("7841976039:AAHcSKzf1a5ImAr5TW4rVf5gLJcyQy2KDXs");

const BASE_URL = "https://api.binance.com/api/v3";

/**
 * Binance'ten yüzde değişimi hesaplayan fonksiyon (interval parametreli)
 */
async function getPercentageChange(symbol, interval) {
    try {
        const response = await axios.get(`${BASE_URL}/klines`, {
            params: { symbol, interval, limit: 2 }
        });

        const klines = response.data;
        if (klines.length < 2) return null;

        const prevClose = parseFloat(klines[0][4]);
        const currentClose = parseFloat(klines[1][4]);
        return ((currentClose - prevClose) / prevClose) * 100;

    } catch {
        return null;
    }
}

/**
 * En çok yükselen coinleri getirir
 */
async function findTopGainers(interval) {
    const info = await axios.get(`${BASE_URL}/exchangeInfo`);
    const symbols = info.data.symbols
        .filter(s => s.status === "TRADING" && (s.symbol.endsWith("USDT") || s.symbol.endsWith("BUSD")))
        .map(s => s.symbol);

    const results = [];

    await Promise.all(
        symbols.map(sym =>
            getPercentageChange(sym, interval).then(change => {
                if (change !== null) results.push({ symbol: sym, change });
            })
        )
    );

    results.sort((a, b) => b.change - a.change);
    return results.slice(0, 10);
}

/* ------------------ TELEGRAM BOT KISMI ------------------ */

bot.start(ctx => {
    ctx.reply(
        "📊 *MC Binance Bot*\n\nHoşgeldiniz!\nAşağıdaki menüden işlem seçebilirsiniz.",
        { parse_mode: "Markdown" }
    );
});

bot.command("binance", ctx => {
    ctx.reply(
        "⏱ *Hangi süreye göre analiz yapılsın?*",
        {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback("Son 1 dakika", "int_1m"),
                    Markup.button.callback("Son 5 dakika", "int_5m"),
                    Markup.button.callback("Son 10 dakika", "int_10m")
                ],
                [
                    Markup.button.callback("Son 15 dakika", "int_15m"),
                    Markup.button.callback("Son 30 dakika", "int_30m")
                ]
            ])
        }
    );
});

/* ---- Callback işlemleri ---- */

const intervals = {
    int_1m: "1m",
    int_5m: "5m",
    int_10m: "10m",
    int_15m: "15m",
    int_30m: "30m",
};

for (const key in intervals) {
    bot.action(key, async ctx => {
        const interval = intervals[key];
        const interval_turkce = interval.replace('m', ' dakika');
        await ctx.reply(`⏳ *${interval_turkce}* için veriler hesaplanıyor...`, { parse_mode: "Markdown" });

        const top = await findTopGainers(interval);

        let message = `📈 *Son ${interval_turkce} içindeki en çok yükselen 10 coin:*\n\n`;

        top.forEach((item, i) => {
            message += `${i + 1}. *${item.symbol}*: ${item.change.toFixed(2)}%\n`;
        });

        ctx.reply(message, { parse_mode: "Markdown" });
    });
}

bot.launch();
console.log("Bot çalışıyor...");
