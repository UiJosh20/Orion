
import {Pool} from 'pg'
import dotenv from 'dotenv'
import { ENV } from './env.js'
dotenv.config()

const pgPool = new Pool({
    connectionString: ENV.DATABASE_URL,
    ssl:{
        rejectUnauthorized: false,
    }
})

export const query = async(text: string, params?: any[]) => {
    const start = Date.now();
    const res = await pgPool.query(text, params)
    const duration = Date.now() - start
    console.log(`[Database]: Executed query in ${duration}ms, with text: ${text}, params: ${params} and ${res.rowCount} rows`)
    return res
}


export default pgPool
