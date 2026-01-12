import axios from 'axios';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';

interface SmmApiConfig {
  url: string;
  key: string;
}

const getApiConfig = (providerKey: string): SmmApiConfig => {
  switch (providerKey) {
    case 'SMMKINGS':
      return {
        url: process.env.SMMKINGS_API_URL || 'https://smmkings.com/api/v2',
        key: process.env.SMMKINGS_API_KEY || '',
      };
    case 'JAP':
      return {
        url: process.env.JAP_API_URL || 'https://jap.cx/api/v2',
        key: process.env.JAP_API_KEY || '',
      };
    default:
      throw new Error(`Unknown provider: ${providerKey}`);
  }
};

export async function submitOrderToProvider(
  orderId: string,
  service: any,
  quantity: number,
  link: string
): Promise<void> {
  const startTime = Date.now();

  try {
    const config = getApiConfig(service.providerKey);

    const response = await axios.post(config.url, {
      key: config.key,
      action: 'add',
      service: service.providerId,
      link,
      quantity,
    });

    const providerOrderId = response.data?.order;

    if (!providerOrderId || typeof providerOrderId !== 'number') {
      throw new Error('Provider did not return order ID');
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'PROCESSING',
        providerOrderId,
      },
    });

    logger.info('Order submitted to provider', {
      orderId,
      providerOrderId,
      provider: service.providerKey,
      duration: Date.now() - startTime,
    });
  } catch (error: any) {
    logger.error('Failed to submit order to provider', {
      orderId,
      error: error.message,
      provider: service.providerKey,
    });

    // Update order status to FAILED and refund
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order) {
      await prisma.$transaction([
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'FAILED' },
        }),
        prisma.user.update({
          where: { id: order.userId },
          data: { balance: { increment: order.charge } },
        }),
        prisma.transaction.create({
          data: {
            userId: order.userId,
            type: 'REFUND',
            amount: order.charge,
            description: `Order failed: ${error.message}`,
          },
        }),
      ]);
    }
  }
}

export async function checkOrderStatus(
  providerKey: string,
  providerOrderId: number
): Promise<any> {
  const config = getApiConfig(providerKey);

  const response = await axios.post(config.url, {
    key: config.key,
    action: 'status',
    order: providerOrderId,
  });

  return response.data;
}

export async function syncServicesFromProvider(providerKey: string): Promise<{
  created: number;
  updated: number;
}> {
  const config = getApiConfig(providerKey);

  const response = await axios.post(config.url, {
    key: config.key,
    action: 'services',
  });

  const services = response.data;

  if (!Array.isArray(services)) {
    throw new Error('Invalid response from provider');
  }

  let created = 0;
  let updated = 0;

  const usdToKrwRate = 1400; // Default rate, should come from settings

  for (const svc of services) {
    const providerId = Number(svc.service);
    const rateUsd = Number(svc.rate);
    const rateKrw = Math.ceil(rateUsd * usdToKrwRate);
    const priceKrw = Math.ceil(rateKrw * 1.3); // 30% markup

    try {
      const existing = await prisma.service.findFirst({
        where: { providerKey, providerId },
      });

      if (existing) {
        await prisma.service.update({
          where: { id: existing.id },
          data: {
            name: svc.name,
            type: svc.type || 'Default',
            category: svc.category,
            rate: rateKrw,
            rateUsdPer1000: rateUsd,
            min: Number(svc.min),
            max: Number(svc.max),
            isRefill: Boolean(svc.refill),
            isCancel: Boolean(svc.cancel),
          },
        });
        updated++;
      } else {
        await prisma.service.create({
          data: {
            providerKey,
            providerId,
            name: svc.name,
            type: svc.type || 'Default',
            category: svc.category,
            rate: rateKrw,
            rateUsdPer1000: rateUsd,
            price: priceKrw,
            min: Number(svc.min),
            max: Number(svc.max),
            isRefill: Boolean(svc.refill),
            isCancel: Boolean(svc.cancel),
            isActive: false, // New services are inactive by default
          },
        });
        created++;
      }
    } catch (error) {
      logger.error(`Failed to sync service ${providerId}:`, error);
    }
  }

  return { created, updated };
}

export async function getProviderBalance(providerKey: string): Promise<number> {
  const config = getApiConfig(providerKey);

  const response = await axios.post(config.url, {
    key: config.key,
    action: 'balance',
  });

  return Number(response.data.balance) || 0;
}
