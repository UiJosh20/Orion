import express, { Application, Request, Response } from 'express';
import cors from 'cors';

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

export default app;