import app from "./app.js";
import { ENV } from "./config/env.js";


const PORT = ENV.PORT;

app.listen(PORT, () => {
  console.log(`[Server]: Orion intelligence engine running on port ${PORT} in ${ENV.NODE_ENV} mode`);
});