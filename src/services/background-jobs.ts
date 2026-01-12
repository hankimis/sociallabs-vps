import cron from 'node-cron';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';
import { checkOrderStatus } from './smm-api';

// Status mapping from provider to our system
const statusMap: Record<string, string> = {
  Pending: 'PENDING',
  'In progress': 'PROCESSING',
  Processing: 'PROCESSING',
  Completed: 'COMPLETED',
  Partial: 'PARTIAL',
  Canceled: 'CANCELED',
  Refunded: 'CANCELED',
  Failed: 'FAILED',
};

// ========== Job Status Tracking ==========
export type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface JobHistory {
  jobName: string;
  status: JobStatus;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  result?: {
    processed?: number;
    updated?: number;
    failed?: number;
    deleted?: number;
  };
  error?: string;
}

export interface JobStats {
  orderSync: {
    status: JobStatus;
    lastRun?: Date;
    lastDuration?: number;
    lastResult?: {
      processed: number;
      updated: number;
      failed: number;
    };
    totalRuns: number;
    totalErrors: number;
  };
  logCleanup: {
    status: JobStatus;
    lastRun?: Date;
    lastResult?: {
      deleted: number;
    };
    totalRuns: number;
  };
  serviceSync: {
    status: JobStatus;
    lastRun?: Date;
    lastDuration?: number;
    lastResult?: {
      created: number;
      updated: number;
      deactivated: number;
    };
    totalRuns: number;
    totalErrors: number;
  };
}

// Global job stats
const jobStats: JobStats = {
  orderSync: {
    status: 'idle',
    totalRuns: 0,
    totalErrors: 0,
  },
  logCleanup: {
    status: 'idle',
    totalRuns: 0,
  },
  serviceSync: {
    status: 'idle',
    totalRuns: 0,
    totalErrors: 0,
  },
};

// Recent job history (keep last 50)
const jobHistory: JobHistory[] = [];
const MAX_HISTORY = 50;

function addJobHistory(entry: JobHistory) {
  jobHistory.unshift(entry);
  if (jobHistory.length > MAX_HISTORY) {
    jobHistory.pop();
  }
}

// ========== Job Functions ==========

async function syncOrderStatuses(): Promise<void> {
  if (jobStats.orderSync.status === 'running') {
    logger.warn('Order sync already running, skipping...');
    return;
  }

  const startTime = Date.now();
  jobStats.orderSync.status = 'running';
  jobStats.orderSync.lastRun = new Date();
  jobStats.orderSync.totalRuns++;

  const historyEntry: JobHistory = {
    jobName: 'orderSync',
    status: 'running',
    startedAt: new Date(),
  };

  try {
    // Get orders that need status sync (PENDING or PROCESSING)
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        providerOrderId: { not: null },
      },
      include: {
        service: {
          select: { providerKey: true },
        },
      },
      take: 100, // Process in batches
    });

    if (orders.length === 0) {
      jobStats.orderSync.status = 'completed';
      jobStats.orderSync.lastResult = { processed: 0, updated: 0, failed: 0 };
      jobStats.orderSync.lastDuration = Date.now() - startTime;

      historyEntry.status = 'completed';
      historyEntry.completedAt = new Date();
      historyEntry.duration = Date.now() - startTime;
      historyEntry.result = { processed: 0, updated: 0, failed: 0 };
      addJobHistory(historyEntry);
      return;
    }

    logger.info(`Syncing ${orders.length} order statuses...`);

    let updated = 0;
    let failed = 0;

    for (const order of orders) {
      if (!order.providerOrderId || !order.service?.providerKey) continue;

      try {
        const result = await checkOrderStatus(
          order.service.providerKey,
          order.providerOrderId
        );

        const newStatus = statusMap[result.status] || order.status;

        if (newStatus !== order.status) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: newStatus,
              startCount: result.start_count ? Number(result.start_count) : undefined,
              remains: result.remains ? Number(result.remains) : undefined,
            },
          });

          // Handle refund for canceled/failed orders
          if (
            ['CANCELED', 'FAILED'].includes(newStatus) &&
            !['CANCELED', 'FAILED'].includes(order.status)
          ) {
            await prisma.$transaction([
              prisma.user.update({
                where: { id: order.userId },
                data: { balance: { increment: order.charge } },
              }),
              prisma.transaction.create({
                data: {
                  userId: order.userId,
                  type: 'REFUND',
                  amount: order.charge,
                  description: `Order ${newStatus.toLowerCase()}: ${order.id}`,
                },
              }),
            ]);
          }

          updated++;
        }
      } catch (error) {
        logger.error(`Failed to sync order ${order.id}:`, error);
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const duration = Date.now() - startTime;
    logger.info(`Order sync completed`, { updated, failed, duration });

    jobStats.orderSync.status = 'completed';
    jobStats.orderSync.lastResult = { processed: orders.length, updated, failed };
    jobStats.orderSync.lastDuration = duration;

    historyEntry.status = 'completed';
    historyEntry.completedAt = new Date();
    historyEntry.duration = duration;
    historyEntry.result = { processed: orders.length, updated, failed };
    addJobHistory(historyEntry);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Order sync job failed:', error);

    jobStats.orderSync.status = 'failed';
    jobStats.orderSync.totalErrors++;
    jobStats.orderSync.lastDuration = Date.now() - startTime;

    historyEntry.status = 'failed';
    historyEntry.completedAt = new Date();
    historyEntry.duration = Date.now() - startTime;
    historyEntry.error = errorMsg;
    addJobHistory(historyEntry);
  }
}

async function cleanupOldLogs(): Promise<void> {
  const startTime = Date.now();
  jobStats.logCleanup.status = 'running';
  jobStats.logCleanup.lastRun = new Date();
  jobStats.logCleanup.totalRuns++;

  const historyEntry: JobHistory = {
    jobName: 'logCleanup',
    status: 'running',
    startedAt: new Date(),
  };

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deleted = await prisma.adminLog.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
      },
    });

    if (deleted.count > 0) {
      logger.info(`Cleaned up ${deleted.count} old admin logs`);
    }

    jobStats.logCleanup.status = 'completed';
    jobStats.logCleanup.lastResult = { deleted: deleted.count };

    historyEntry.status = 'completed';
    historyEntry.completedAt = new Date();
    historyEntry.duration = Date.now() - startTime;
    historyEntry.result = { deleted: deleted.count };
    addJobHistory(historyEntry);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Log cleanup failed:', error);

    jobStats.logCleanup.status = 'failed';

    historyEntry.status = 'failed';
    historyEntry.completedAt = new Date();
    historyEntry.duration = Date.now() - startTime;
    historyEntry.error = errorMsg;
    addJobHistory(historyEntry);
  }
}

// ========== Service Sync Tracking ==========
export function updateServiceSyncStats(result: {
  status: JobStatus;
  created?: number;
  updated?: number;
  deactivated?: number;
  duration?: number;
  error?: string;
}) {
  jobStats.serviceSync.status = result.status;
  jobStats.serviceSync.lastRun = new Date();
  jobStats.serviceSync.totalRuns++;

  if (result.duration) {
    jobStats.serviceSync.lastDuration = result.duration;
  }

  if (result.status === 'completed') {
    jobStats.serviceSync.lastResult = {
      created: result.created || 0,
      updated: result.updated || 0,
      deactivated: result.deactivated || 0,
    };
  }

  if (result.status === 'failed') {
    jobStats.serviceSync.totalErrors++;
  }

  const historyEntry: JobHistory = {
    jobName: 'serviceSync',
    status: result.status,
    startedAt: new Date(Date.now() - (result.duration || 0)),
    completedAt: new Date(),
    duration: result.duration,
    result: result.status === 'completed' ? {
      processed: (result.created || 0) + (result.updated || 0),
      updated: result.updated,
    } : undefined,
    error: result.error,
  };
  addJobHistory(historyEntry);
}

// ========== Public API ==========

export function getJobStats(): JobStats {
  return { ...jobStats };
}

export function getJobHistory(): JobHistory[] {
  return [...jobHistory];
}

export async function triggerOrderSync(): Promise<void> {
  await syncOrderStatuses();
}

// ========== Startup ==========

export function startBackgroundJobs(): void {
  // Sync order statuses every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    syncOrderStatuses();
  });

  // Cleanup old logs daily at 3 AM
  cron.schedule('0 3 * * *', () => {
    cleanupOldLogs();
  });

  logger.info('Background jobs started');

  // Run initial sync after 30 seconds
  setTimeout(() => {
    syncOrderStatuses();
  }, 30000);
}
