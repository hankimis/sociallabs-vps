import { Router } from 'express';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';

const router = Router();

// Telegram webhook
router.post('/telegram', async (req, res) => {
  try {
    const update = req.body;

    logger.info('Telegram webhook received:', update);

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      const { id, data } = update.callback_query;

      if (data?.startsWith('approve_') || data?.startsWith('reject_')) {
        const [action, requestId] = data.split('_');

        const request = await prisma.depositRequest.findUnique({
          where: { id: requestId },
        });

        if (request && request.status === 'PENDING') {
          if (action === 'approve') {
            await prisma.$transaction([
              prisma.depositRequest.update({
                where: { id: requestId },
                data: {
                  status: 'APPROVED',
                  processedAt: new Date(),
                },
              }),
              prisma.user.update({
                where: { id: request.userId },
                data: { balance: { increment: request.amount } },
              }),
              prisma.transaction.create({
                data: {
                  userId: request.userId,
                  type: 'DEPOSIT',
                  amount: request.amount,
                  description: 'Deposit approved via Telegram',
                },
              }),
            ]);

            logger.info(`Deposit approved via Telegram: ${requestId}`);
          } else {
            await prisma.depositRequest.update({
              where: { id: requestId },
              data: {
                status: 'REJECTED',
                processedAt: new Date(),
              },
            });

            logger.info(`Deposit rejected via Telegram: ${requestId}`);
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    res.json({ ok: true }); // Always return OK to prevent retries
  }
});

// Health check for webhooks
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;
