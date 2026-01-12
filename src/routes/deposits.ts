import { Router } from 'express';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';
import { sendDepositNotification } from '../services/telegram-polling';

const router = Router();

// ========== Notify VPS of new deposit request ==========
// Called from Next.js when user creates a deposit request
// POST /api/deposits/notify
router.post('/notify', async (req, res, next) => {
  try {
    const { id, amount, depositorName, userEmail, memo } = req.body;

    if (!id || !amount || !depositorName || !userEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Send Telegram notification with approval buttons
    await sendDepositNotification({
      id,
      amount,
      depositorName,
      userEmail,
      memo,
    });

    res.json({ success: true, message: 'Notification sent' });

  } catch (error) {
    logger.error('Deposit notify error:', error);
    next(error);
  }
});

// ========== Get Telegram polling status ==========
router.get('/telegram-status', async (req, res) => {
  try {
    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    res.json({
      telegramEnabled: settings.telegramEnabled,
      hasBotToken: !!settings.telegramBotToken,
      hasChatId: !!settings.telegramChatId,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

export default router;
