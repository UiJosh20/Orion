import path from "path";
import pgPool from "../config/db.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(){
  try{
    const schemaPath = path.join(__dirname, '../config/schema.sql')
    const sqlQuery = readFileSync(schemaPath, 'utf-8')
    console.log(`[Database]: Running migration query...`);
    await pgPool.query(sqlQuery)
    console.log(`[Database]: Migration query completed successfully, tables are ready!`);
    process.exit(0)
  }catch(error:any){
    console.error(`[Database]: Error running migration query: ${error}`)
    process.exit(1)
  }
}

runMigration()