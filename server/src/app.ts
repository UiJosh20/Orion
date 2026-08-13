import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swaggerOutput from './swagger-output.json' with { type: 'json' };

// Module Routers
import marketRoutes from './modules/market/market.routes.js';
import alertRoutes from './modules/alert/alert.routes.js';
import aiRoutes from './modules/ai/ai.routes.js';
import sessionRoutes from './modules/session/session.routes.js';
import authRoutes from './modules/auth/auth.routes.js'; // 👈 1. IMPORT AUTH ROUTES
import { ENV } from './config/env.js';

const app: Application = express();

// Trust proxy for rate limiting accuracy
app.set('trust proxy', 1);

// 1. CORS (Must come before rate-limiter so OPTIONS preflights pass through)
app.use(
  cors({
    origin: ENV.CLIENT_URL || 'http://localhost:3000',
    // origin: 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Uuid', 'x-device-uuid'],
  })
);

// 2. Helmet HTTP Security Headers
app.use(helmet());

// 3. Body & Cookie Parsers
app.use(express.json());
app.use(cookieParser());

// 4. Rate Limiter for Auth Routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 30 : 1000,
  message: { error: 'Too many auth requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || process.env.NODE_ENV !== 'production',
});

// Apply rate-limiter middleware
app.use('/api/auth', authLimiter);

// 5. Mount API Routers
app.use('/api/auth', authRoutes); // 👈 2. MOUNT AUTH ROUTES HERE
app.use('/api/market', marketRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/session', sessionRoutes);

// Swagger Documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

// Health Check Endpoint
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Orion Backend is up and running smoothly 🚀',
    timestamp: new Date().toISOString(),
  });
});

export default app;