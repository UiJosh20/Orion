import app from "./app.js";
import pgPool from "./config/db.js";
import { ENV } from "./config/env.js";
import { AlertWorkerService } from "./modules/alert/alert.service.js";


const PORT = ENV.PORT;


const startServer = async()=>{
try{
  const client = await pgPool.connect()
  const res = await client.query('SELECT NOW()');
  console.log( `[Database]: Connected to database at ${res.rows[0].now}`)
  AlertWorkerService.startAlertEngine(10000);
  app.listen(PORT, () => {
    console.log(`[Server]: Orion intelligence engine running on port ${PORT} in ${ENV.NODE_ENV} mode`);
  });

}catch(error:any){
  console.error(`[Database]: Error connecting to database: ${error}`)
  process.exit(1)
}
}

startServer()