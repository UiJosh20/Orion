import axios from "axios";
import pgPool from "../config/db.js"; // Adjust path to your database connection pool

interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
}

export async function seedCryptoSymbols() {
  console.log("🚀 Starting crypto symbol seeding...");

  try {
    // 1. Fetch official active market info from Binance REST API
    const response = await axios.get("https://api.binance.com/api/v3/exchangeInfo");
    const symbols: BinanceSymbol[] = response.data.symbols;

    // 2. Filter for active spot trading pairs against key liquid quote currencies
    const targetQuoteCurrencies = new Set(["USDT", "USDC", "BTC", "ETH"]);
    
    const activePairs = symbols.filter(
      (item) =>
        item.status === "TRADING" &&
        item.isSpotTradingAllowed &&
        targetQuoteCurrencies.has(item.quoteAsset)
    );

    console.log(`🔍 Found ${activePairs.length} active crypto trading pairs.`);

    if (activePairs.length === 0) {
      console.warn("⚠️ No symbols matched the filter criteria.");
      return;
    }

    // 3. Perform batch UPSERT in chunks of 100
    const BATCH_SIZE = 100;
    let seededTotal = 0;

    for (let i = 0; i < activePairs.length; i += BATCH_SIZE) {
      const batch = activePairs.slice(i, i + BATCH_SIZE);

      const valuePlaceholders: string[] = [];
      const queryValues: any[] = [];

      batch.forEach((pair, index) => {
        const offset = index * 4;
        valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
        
        const displayName = `${pair.baseAsset}/${pair.quoteAsset}`;
        queryValues.push(pair.symbol, displayName, "crypto", "binance");
      });

      const upsertQuery = `
        INSERT INTO supported_symbols (symbol, name, category, exchange)
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (symbol) DO UPDATE 
        SET name = EXCLUDED.name,
            category = EXCLUDED.category,
            exchange = EXCLUDED.exchange;
      `;

      await pgPool.query(upsertQuery, queryValues);
      seededTotal += batch.length;
      console.log(`✅ Inserted/Updated ${seededTotal}/${activePairs.length} symbols...`);
    }

    console.log("🎉 Seeding complete!");
  } catch (error: any) {
    console.error("❌ Seeding failed:", error.message || error);
  } finally {
    await pgPool.end();
  }
}

// Execute directly when run as a script
seedCryptoSymbols();