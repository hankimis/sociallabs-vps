import prisma from '../utils/prisma';
import { logger } from '../utils/logger';

// ========== Telegram Polling Service ==========
// Instead of webhooks, VPS polls Telegram for updates

let lastUpdateId = 0;
let isPolling = false;
let pollInterval: NodeJS.Timeout | null = null;

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data: string;
    message?: {
      chat: { id: number };
      message_id: number;
    };
  };
}

interface TelegramSettings {
  telegramEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

async function getSettings(): Promise<TelegramSettings | null> {
  try {
    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    return settings as TelegramSettings;
  } catch (e) {
    logger.error('Failed to get Telegram settings:', e);
    return null;
  }
}

async function telegramApi(botToken: string, method: string, body: unknown): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
}) {
  const { botToken, chatId, text, replyMarkup } = params;

  await telegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function editMessage(botToken: string, chatId: number, messageId: number, text: string) {
  try {
    await telegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    logger.error('Failed to edit Telegram message:', e);
  }
}

async function answerCallback(botToken: string, callbackId: string, text: string) {
  try {
    await telegramApi(botToken, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      text,
    });
  } catch (e) {
    // Ignore - callback might have expired
  }
}

async function processCallbackQuery(
  settings: TelegramSettings,
  callback: TelegramUpdate['callback_query']
) {
  if (!callback || !settings.telegramBotToken) return;

  const data = String(callback.data || '');
  const [kind, id, action] = data.split(':');

  if (kind !== 'deposit' || !id || (action !== 'APPROVE' && action !== 'REJECT')) {
    return;
  }

  // Acknowledge click
  await answerCallback(settings.telegramBotToken, callback.id, '처리 중...');

  // Find deposit request
  const reqRow = await prisma.depositRequest.findUnique({ where: { id } });

  if (!reqRow) {
    if (callback.message) {
      await editMessage(
        settings.telegramBotToken,
        callback.message.chat.id,
        callback.message.message_id,
        `❗ 요청을 찾을 수 없습니다. (${id})`
      );
    }
    return;
  }

  if (reqRow.status !== 'PENDING') {
    if (callback.message) {
      await editMessage(
        settings.telegramBotToken,
        callback.message.chat.id,
        callback.message.message_id,
        `ℹ️ 이미 처리된 요청입니다. (status: ${reqRow.status})`
      );
    }
    return;
  }

  try {
    // Process approval/rejection
    const ops: any[] = [];

    if (action === 'APPROVE') {
      ops.push(
        prisma.user.update({
          where: { id: reqRow.userId },
          data: { balance: { increment: reqRow.amount } },
        }),
        prisma.transaction.create({
          data: {
            userId: reqRow.userId,
            amount: reqRow.amount,
            type: 'DEPOSIT',
            description: `Deposit approved (telegram: ${reqRow.id})`,
          },
        })
      );
    }

    ops.push(
      prisma.depositRequest.update({
        where: { id },
        data: {
          status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          processedAt: new Date(),
          processedById: null,
          adminNote: 'Processed via Telegram (VPS)',
        },
      })
    );

    await prisma.$transaction(ops);

    const resultText =
      action === 'APPROVE'
        ? `✅ 승인 완료\n- 금액: ${reqRow.amount.toLocaleString()}원\n- 요청ID: ${id}`
        : `❌ 거절 완료\n- 금액: ${reqRow.amount.toLocaleString()}원\n- 요청ID: ${id}`;

    if (callback.message) {
      await editMessage(
        settings.telegramBotToken,
        callback.message.chat.id,
        callback.message.message_id,
        resultText
      );
    }

    logger.info(`Deposit ${action.toLowerCase()}ed via Telegram`, { id, amount: reqRow.amount });

  } catch (e: any) {
    logger.error('Telegram deposit callback failed:', e);
    if (callback.message) {
      await editMessage(
        settings.telegramBotToken,
        callback.message.chat.id,
        callback.message.message_id,
        `❗ 처리 실패: ${String(e?.message || e)}`
      );
    }
  }
}

async function pollTelegramUpdates() {
  if (isPolling) return;
  isPolling = true;

  try {
    const settings = await getSettings();

    if (!settings?.telegramEnabled || !settings.telegramBotToken) {
      isPolling = false;
      return;
    }

    const result = await telegramApi(settings.telegramBotToken, 'getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 10,
      allowed_updates: ['callback_query'],
    });

    const updates: TelegramUpdate[] = result?.result || [];

    for (const update of updates) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);

      if (update.callback_query) {
        await processCallbackQuery(settings, update.callback_query);
      }
    }

  } catch (e) {
    // Don't log timeout errors
    const errMsg = String(e);
    if (!errMsg.includes('ETIMEDOUT') && !errMsg.includes('timeout')) {
      logger.error('Telegram polling error:', e);
    }
  } finally {
    isPolling = false;
  }
}

// ========== Send Deposit Notification ==========
export async function sendDepositNotification(deposit: {
  id: string;
  amount: number;
  depositorName: string;
  userEmail: string;
  memo?: string | null;
}) {
  try {
    const settings = await getSettings();

    if (!settings?.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
      return;
    }

    const text =
      `<b>💳 충전 신청</b>\n` +
      `- 금액: <b>${deposit.amount.toLocaleString()}원</b>\n` +
      `- 입금자: <b>${escapeHtml(deposit.depositorName)}</b>\n` +
      `- 유저: ${deposit.userEmail}\n` +
      (deposit.memo ? `- 메모: ${escapeHtml(deposit.memo)}\n` : '') +
      `- 상태: PENDING`;

    await sendTelegramMessage({
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      text,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ 승인', callback_data: `deposit:${deposit.id}:APPROVE` },
            { text: '❌ 거절', callback_data: `deposit:${deposit.id}:REJECT` },
          ],
        ],
      },
    });

    logger.info('Deposit notification sent to Telegram', { depositId: deposit.id });

  } catch (e) {
    logger.error('Failed to send Telegram deposit notification:', e);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ========== Start/Stop Polling ==========
export function startTelegramPolling() {
  if (pollInterval) return;

  logger.info('Starting Telegram polling...');

  // Poll every 3 seconds
  pollInterval = setInterval(() => {
    pollTelegramUpdates();
  }, 3000);

  // Initial poll
  pollTelegramUpdates();
}

export function stopTelegramPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Telegram polling stopped');
  }
}

// ========== Status ==========
export function getTelegramPollingStatus() {
  return {
    running: pollInterval !== null,
    lastUpdateId,
  };
}
