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

async function syncOrderStatuses(): Promise<void> {
  const startTime = Date.now();

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
  } catch (error) {
    logger.error('Order sync job failed:', error);
  }
}

async function cleanupOldLogs(): Promise<void> {
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
  } catch (error) {
    logger.error('Log cleanup failed:', error);
  }
}

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
