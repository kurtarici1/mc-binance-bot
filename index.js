const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

// API key'i ortam değişkeninden güvenli bir şekilde çeker.
const bot = new Telegraf(process.env.TG_BOT_TOKEN || "DEFAULT_BOT_TOKEN");

const BASE_URL = "https://api.binance.com/api/v3";

/**
 * Binance'ten yüzde değişimi hesaplayan fonksiyon (interval parametreli)
 * Hata Kontrolü: API isteği ve veri dönüşümü hatalarını yakalar.
 */
async function getPercentageChange(symbol, interval) {
    try {
        const response = await axios.get(`${BASE_URL}/klines`, {
            params: { symbol, interval, limit: 2 }
        });

        const klines = response.data;
        if (!Array.isArray(klines) || klines.length < 2) return null;

        const prevClose = parseFloat(klines[0][4]);
        const currentClose = parseFloat(klines[1][4]);

        // Sıfıra bölme hatası kontrolü
        if (prevClose === 0) return null;

        return ((currentClose - prevClose) / prevClose) * 100;

    } catch (error) {
        // API kısıtlaması (429) veya ağ hatalarını loglayıp null döndürür.
        if (error.response && error.response.status === 429) {
            console.error(`Rate Limit Hatası (429) ${symbol} için: Çok fazla istek.`);
        } else if (error.message) {
            console.error(`Veri Çekme Hatası ${symbol} için:`, error.message);
        }
        return null;
    }
}

/**
 * En çok yükselen coinleri getirir.
 * Hata Kontrolü: exchangeInfo isteği hatalarını ve Promise.all hatalarını yakalar.
 */
async function findTopGainers(interval) {
    try {
        const info = await axios.get(`${BASE_URL}/exchangeInfo`);
        const symbols = info.data.symbols
            .filter(s => s.status === "TRADING" && (s.symbol.endsWith("USDT") || s.symbol.endsWith("BUSD")))
            .map(s => s.symbol);

        const results = [];

        // Promise.all hatalarını yakalamak için .catch eklendi
        const promises = symbols.map(sym =>
            getPercentageChange(sym, interval)
                .then(change => {
                    if (change !== null) results.push({ symbol: sym, change });
                })
                .catch(e => {
                    // getPercentageChange'in catch bloğu zaten null döndürdüğü için 
                    // bu genellikle ağ bağlantısı kesilmesi gibi ciddi hatalar içindir.
                    console.error(`Promise başarısız oldu: ${sym}`, e.message);
                })
        );

        await Promise.all(promises);

        results.sort((a, b) => b.change - a.change);
        // Minimum 1 sonuç döndürmesi için kontrol
        return results.slice(0, 10);
    } catch (e) {
        console.error("findTopGainers ana hatası:", e.message);
        return []; // Hata durumunda boş liste döndür
    }
}

// Bot komutları ve eylemleri
bot.start(ctx => {
    // ctx.reply() hatalarını yakalamak için try/catch eklenmedi, Telegraf zaten kendi içinde basit hataları yönetir.
    ctx.reply(
        "📊 *MC Binance Bot*\n\nHoşgeldiniz!\n\nEn çok yükselen coinleri görmek için 👇\n/binance komutunu kullanın.",
        {
            parse_mode: "Markdown",
            reply_markup: {
                remove_keyboard: true
            }
        }
    ).catch(e => console.error("Start mesajı gönderilemedi:", e.message));
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
    ).catch(e => console.error("Binance menüsü gönderilemedi:", e.message));
});

const intervals = {
    int_1m: "1m",
    int_5m: "5m",
    int_10m: "10m",
    int_15m: "15m",
    int_30m: "30m",
};

let istek_sayisi = 0;

for (const key in intervals) {
    bot.action(key, async ctx => {
        // Callback sorgusunun zaman aşımı hatasını (400 Bad Request) önlemek için 
        // answerCbQuery'i uzun süren işlemden (findTopGainers) önce çağırıyoruz.
        try {
            // Kullanıcıya işlemin başladığını belirten küçük bir bildirim göster
            await ctx.answerCbQuery('Hesaplamalar Başlatıldı. Lütfen bekleyin...', true); 
        } catch (e) {
            console.error("answerCbQuery hatası:", e.message);
            // Hata olsa bile işleme devam et
        }

        const interval = intervals[key];
        const interval_turkce = interval.replace('m', ' dakika');
        let loadingMessage;
        
        try {
            loadingMessage = await ctx.reply(`⏳ *${interval_turkce}* için veriler hesaplanıyor...`, { parse_mode: "Markdown" });
        } catch (e) {
            console.error("Yükleme mesajı gönderilemedi:", e.message);
            return; // Devam edemezsek fonksiyonu sonlandır
        }
        
        // Ana hesaplama kısmı
        const top = await findTopGainers(interval);
        
        let message;

        if (top.length === 0) {
            message = `⚠️ *Son ${interval_turkce}* için veri çekilemedi veya yükseliş gösteren coin bulunamadı. Lütfen daha sonra tekrar deneyin.`;
        } else {
            message = `📈 *Son ${interval_turkce} içindeki en çok yükselen ${top.length} coin:*\n\n`;
            top.forEach((item, i) => {
                message += `${i + 1}. *${item.symbol}*: ${item.change.toFixed(2)}%\n`;
            });
        }
        
        // Mesaj düzenleme (editMessageText) hatasını yakalama (Telegram sunucusu bazen bu hatayı verebilir)
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMessage.message_id,
                null,
                message,
                { parse_mode: "Markdown" }
            );
        } catch (e) {
            console.error("Mesaj düzenleme hatası:", e.message);
            // Düzenleme başarısız olursa, yeni mesaj olarak göndermeyi dene
            try {
                await ctx.reply(message, { parse_mode: "Markdown" });
            } catch (replyError) {
                console.error("Yedek mesaj gönderilemedi:", replyError.message);
            }
        }
        
        istek_sayisi += 1;
        console.log(`✔️ Liste gönderildi. İstek sayısı: ${istek_sayisi}`);
    });
}

// Bot başlatma ve 409 Conflict hatasını önleme
async function startBot() {
    // 409 Conflict hatasını (Polling çakışması) önlemek için Webhook temizliği.
    try {
        await bot.telegram.deleteWebhook();
        console.log("Webhook temizlendi.");
    } catch (e) {
        console.log("Webhook temizlenemedi (Muhtemelen hiç ayarlanmamıştı).");
    }
    
    // Uygulama seviyesinde hataları yakalama
    bot.catch((err, ctx) => {
        console.error(`Olası işlenmeyen hata: ${ctx.updateType} güncellemesi sırasında.`, err);
        // Kullanıcıya basit bir hata mesajı gönderme (isteğe bağlı)
        if (ctx.chat) {
            ctx.reply('Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.').catch(() => {});
        }
    });

    bot.launch();
    console.log("🤖 Bot çalışıyor...");
}

startBot();
