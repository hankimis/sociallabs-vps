import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import prisma from './utils/prisma';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import orderRoutes from './routes/orders';
import serviceRoutes from './routes/services';
import adminRoutes from './routes/admin';
import agentRoutes from './routes/agent';
import webhookRoutes from './routes/webhooks';

// Background Jobs
import { startBackgroundJobs, getJobStats, getJobHistory, triggerOrderSync } from './services/background-jobs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const startTime = new Date();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Request logging (skip health check to reduce noise)
app.use((req, res, next) => {
  if (!req.path.startsWith('/health') && !req.path.startsWith('/api/vps/status')) {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  }
  next();
});

// ========== Health & Status Endpoints ==========

// Basic health check (for load balancers)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Detailed VPS status (for admin dashboard)
app.get('/api/vps/status', async (req, res) => {
  try {
    // Check database connection
    let dbStatus = 'ok';
    let dbLatency = 0;
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
    } catch {
      dbStatus = 'error';
    }

    // Get memory usage
    const memUsage = process.memoryUsage();

    // Get job stats
    const jobs = getJobStats();

    res.json({
      status: 'online',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      startedAt: startTime.toISOString(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
      },
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      },
      jobs: {
        orderSync: {
          status: jobs.orderSync.status,
          lastRun: jobs.orderSync.lastRun,
          lastDuration: jobs.orderSync.lastDuration,
          lastResult: jobs.orderSync.lastResult,
          totalRuns: jobs.orderSync.totalRuns,
          totalErrors: jobs.orderSync.totalErrors,
        },
        serviceSync: {
          status: jobs.serviceSync.status,
          lastRun: jobs.serviceSync.lastRun,
          lastDuration: jobs.serviceSync.lastDuration,
          lastResult: jobs.serviceSync.lastResult,
          totalRuns: jobs.serviceSync.totalRuns,
          totalErrors: jobs.serviceSync.totalErrors,
        },
        logCleanup: {
          status: jobs.logCleanup.status,
          lastRun: jobs.logCleanup.lastRun,
          lastResult: jobs.logCleanup.lastResult,
          totalRuns: jobs.logCleanup.totalRuns,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Job history
app.get('/api/vps/jobs/history', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const history = getJobHistory().slice(0, limit);
  res.json({ history });
});

// Trigger order sync manually
app.post('/api/vps/jobs/order-sync', authMiddleware, async (req, res) => {
  try {
    // Run in background
    triggerOrderSync();
    res.json({ success: true, message: 'Order sync triggered' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ========== API Routes ==========
app.use('/api/auth', authRoutes);
app.use('/api/user', authMiddleware, userRoutes);
app.use('/api/orders', authMiddleware, orderRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/agent', authMiddleware, agentRoutes);
app.use('/api/webhooks', webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`VPS Backend Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background jobs
  startBackgroundJobs();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;
