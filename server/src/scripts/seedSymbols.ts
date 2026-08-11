import axios from "axios";
import pgPool from "../config/db.js";
import { ENV } from "../config/env.js";

interface SymbolRecord {
  symbol: string;
  name: string;
  category: "crypto" | "forex";
  exchange: string;
}

// Ensure the table exists before attempting population
async function ensureTableExists() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS supported_symbols (
      symbol VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      category VARCHAR(20) NOT NULL,
      exchange VARCHAR(50) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pgPool.query(createTableQuery);
  console.log("[DB Setup]: Ensured 'supported_symbols' table exists.");
}

// 1. Fetch Crypto symbols dynamically from Binance
async function fetchBinanceCryptoSymbols(): Promise<SymbolRecord[]> {
  try {
    console.log("[Seeder]: Fetching live crypto pairs from Binance REST API...");
    const response = await axios.get("https://api.binance.com/api/v3/exchangeInfo");
    
    const symbolsData = response.data.symbols || [];

    // Filter top active spot pairs quoted in USDT (e.g. BTCUSDT, ETHUSDT)
    const cryptoPairs = symbolsData
      .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.isSpotTradingAllowed)
      .slice(0, 60) // Limit to top 60 popular tokens
      .map((s: any) => ({
        symbol: s.symbol,
        name: `${s.baseAsset} / USDT`,
        category: "crypto" as const,
        exchange: "Binance",
      }));

    console.log(`[Seeder]: Retrived ${cryptoPairs.length} crypto symbols from Binance.`);
    return cryptoPairs;
  } catch (error: any) {
    console.error("[Seeder Error]: Failed to fetch Binance crypto symbols:", error.message);
    return [];
  }
}

// 2. Fetch Forex symbols dynamically from Twelve Data API
async function fetchTwelveDataForexSymbols(): Promise<SymbolRecord[]> {
  try {
    console.log("[Seeder]: Fetching forex pairs from Twelve Data API...");
    const apiKey = ENV.TWELVE_DATA_API_KEY;
    const url = `https://api.twelvedata.com/forex_pairs${apiKey ? `?apikey=${apiKey}` : ""}`;
    
    const response = await axios.get(url);
    const forexData = response.data.data || [];

    // Filter major & popular Forex pairs
    const forexPairs = forexData
      .filter((item: any) => item.currency_group === "Major" || item.currency_group === "Minor")
      .slice(0, 40) // Limit to top 40 major/minor pairs
      .map((item: any) => ({
        symbol: item.symbol, // e.g. "EUR/USD"
        name: `${item.currency_base} / ${item.currency_quote}`,
        category: "forex" as const,
        exchange: "Forex",
      }));

    console.log(`[Seeder]: Retrieved ${forexPairs.length} forex symbols from Twelve Data.`);
    return forexPairs;
  } catch (error: any) {
    console.warn("[Seeder Warning]: Failed to fetch from Twelve Data, utilizing major Forex pairs fallback.");
    
    // Fallback list of major forex pairs if API limits are hit
    const fallbackForex: SymbolRecord[] = [
      { symbol: "EUR/USD", name: "Euro / US Dollar", category: "forex", exchange: "Forex" },
      { symbol: "GBP/USD", name: "British Pound / US Dollar", category: "forex", exchange: "Forex" },
      { symbol: "USD/JPY", name: "US Dollar / Japanese Yen", category: "forex", exchange: "Forex" },
      { symbol: "AUD/USD", name: "Australian Dollar / US Dollar", category: "forex", exchange: "Forex" },
      { symbol: "USD/CAD", name: "US Dollar / Canadian Dollar", category: "forex", exchange: "Forex" },
      { symbol: "USD/CHF", name: "US Dollar / Swiss Franc", category: "forex", exchange: "Forex" },
      { symbol: "NZD/USD", name: "New Zealand Dollar / US Dollar", category: "forex", exchange: "Forex" },
      { symbol: "EUR/GBP", name: "Euro / British Pound", category: "forex", exchange: "Forex" },
      { symbol: "EUR/JPY", name: "Euro / Japanese Yen", category: "forex", exchange: "Forex" },
      { symbol: "GBP/JPY", name: "British Pound / Japanese Yen", category: "forex", exchange: "Forex" },
    ];
    return fallbackForex;
  }
}

// 3. Populate / Bulk Upsert into PostgreSQL
async function seedSymbols() {
  try {
    await ensureTableExists();

    const [cryptoSymbols, forexSymbols] = await Promise.all([
      fetchBinanceCryptoSymbols(),
      fetchTwelveDataForexSymbols(),
    ]);

    const allSymbols = [...cryptoSymbols, ...forexSymbols];

    if (allSymbols.length === 0) {
      console.log("[Seeder]: No symbols were retrieved. Exiting.");
      process.exit(0);
    }

    console.log(`[Seeder]: Inserting/Updating ${allSymbols.length} total symbols in database...`);

    let insertedCount = 0;

    for (const item of allSymbols) {
      const query = `
        INSERT INTO supported_symbols (symbol, name, category, exchange)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (symbol) 
        DO UPDATE SET name = EXCLUDED.name, exchange = EXCLUDED.exchange;
      `;
      await pgPool.query(query, [item.symbol, item.name, item.category, item.exchange]);
      insertedCount++;
    }

    console.log(`[Seeder Success]: Successfully populated ${insertedCount} supported symbols into database!`);
  } catch (error: any) {
    console.error("[Seeder Error]: Execution failed:", error);
  } finally {
    await pgPool.end();
    process.exit(0);
  }
}

// Execute the script
seedSymbols();