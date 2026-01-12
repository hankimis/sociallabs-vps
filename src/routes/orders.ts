import { Router } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';
import { submitOrderToProvider } from '../services/smm-api';

const router = Router();

// Create order
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { serviceId, quantity, link, agentCode } = req.body;

    if (!serviceId || !quantity || !link) {
      throw new AppError(400, 'Service ID, quantity, and link required');
    }

    // Get service
    const service = await prisma.service.findUnique({
      where: { id: Number(serviceId) },
    });

    if (!service) {
      throw new AppError(404, 'Service not found');
    }

    if (!service.isActive) {
      throw new AppError(400, 'Service is not active');
    }

    // Validate quantity
    if (quantity < service.min || quantity > service.max) {
      throw new AppError(400, `Quantity must be between ${service.min} and ${service.max}`);
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Calculate charge
    const pricePerUnit = service.price / 1000;
    const charge = Math.ceil(quantity * pricePerUnit);

    // Check balance
    if (user.balance < charge) {
      throw new AppError(400, `Insufficient balance. Required: ${charge}, Available: ${user.balance}`);
    }

    // Check agent code and calculate commission
    let agentCommission = 0;
    let validatedAgentCode: string | null = null;

    if (agentCode) {
      const agent = await prisma.user.findFirst({
        where: { referralCode: agentCode, role: 'AGENT' },
        include: { agentProfile: true },
      });

      if (agent?.agentProfile) {
        agentCommission = Math.floor((charge * agent.agentProfile.commissionRate) / 100);
        validatedAgentCode = agentCode;
      }
    }

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Deduct balance
      await tx.user.update({
        where: { id: req.user!.id },
        data: { balance: { decrement: charge } },
      });

      // Create transaction record
      await tx.transaction.create({
        data: {
          userId: req.user!.id,
          type: 'ORDER',
          amount: -charge,
          description: `Order: ${service.name}`,
        },
      });

      // Create order
      const newOrder = await tx.order.create({
        data: {
          userId: req.user!.id,
          serviceId: service.id,
          quantity,
          charge,
          link,
          status: 'PENDING',
          agentCodeApplied: validatedAgentCode,
          agentCommission,
        },
      });

      return newOrder;
    });

    logger.info(`Order created: ${order.id}`, {
      userId: req.user!.id,
      serviceId,
      charge,
    });

    // Submit to provider asynchronously (don't wait)
    if (service.providerKey !== 'LOCAL') {
      submitOrderToProvider(order.id, service, quantity, link).catch((err) => {
        logger.error('Failed to submit order to provider:', err);
      });
    }

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        charge,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get user orders
router.get('/list', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', pageSize = '20', status } = req.query;

    const where: any = { userId: req.user!.id };
    if (status && status !== 'all') {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          service: {
            select: {
              id: true,
              name: true,
              platform: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(pageSize),
        skip: (Number(page) - 1) * Number(pageSize),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      items: orders,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    next(error);
  }
});

// Cancel order
router.post('/:id/cancel', async (req: AuthRequest, res, next) => {
  try {
<<<<<<< HEAD
    const id = req.params.id as string;
=======
    const id = String(req.params.id);
>>>>>>> 73d6501 (Fix build + improve server script)

    const order = await prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    if (order.userId !== req.user!.id) {
      throw new AppError(403, 'Not authorized to cancel this order');
    }

    if (order.status !== 'PENDING') {
      throw new AppError(400, 'Only pending orders can be canceled');
    }

    // Cancel and refund
    await prisma.$transaction([
      prisma.order.update({
        where: { id },
        data: { status: 'CANCELED' },
      }),
      prisma.user.update({
        where: { id: req.user!.id },
        data: { balance: { increment: order.charge } },
      }),
      prisma.transaction.create({
        data: {
          userId: req.user!.id,
          type: 'REFUND',
          amount: order.charge,
          description: `Order canceled: ${id}`,
        },
      }),
    ]);

    logger.info(`Order canceled: ${id}`);

    res.json({ success: true, message: 'Order canceled and refunded' });
  } catch (error) {
    next(error);
  }
});

export default router;
