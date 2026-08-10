import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import marketRoutes from './modules/market/market.routes.js';
import alertRoutes from './modules/alert/alert.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import swaggerUi from 'swagger-ui-express';
import swaggerOutput from './swagger-output.json' with { type: 'json' };


const app: Application =express();

// Middleware
app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Orion Backend is up and running smoothly 🚀',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/market', marketRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/ai', aiRoutes);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));
export default app;