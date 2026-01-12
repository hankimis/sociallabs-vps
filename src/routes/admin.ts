import { Router } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';
import { syncServicesFromProvider } from '../services/smm-api';
import { invalidateCache as invalidateServicesCache } from './services';

const router = Router();

// Apply admin middleware to all routes
router.use(adminMiddleware);

// Get all users
router.get('/users', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', pageSize = '50', search, role } = req.query;

    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { name: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          balance: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(pageSize),
        skip: (Number(page) - 1) * Number(pageSize),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    next(error);
  }
});

// Get all orders
router.get('/orders', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', pageSize = '50', status, userId } = req.query;

    const where: any = {};
    if (status && status !== 'all') {
      where.status = status;
    }
    if (userId) {
      where.userId = userId;
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, name: true } },
          service: { select: { id: true, name: true, platform: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(pageSize),
        skip: (Number(page) - 1) * Number(pageSize),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ orders, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    next(error);
  }
});

// Refund order
router.post('/orders/:id/refund', async (req: AuthRequest, res, next) => {
  try {
<<<<<<< HEAD
    const id = req.params.id as string;
=======
    const id = String(req.params.id);
>>>>>>> 73d6501 (Fix build + improve server script)
    const { reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!order) {
      throw new AppError(404, 'Order not found');
    }

    // Refund
    await prisma.$transaction([
      prisma.order.update({
        where: { id },
        data: { status: 'CANCELED' },
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
          description: `Admin refund: ${reason || 'No reason provided'}`,
        },
      }),
      prisma.adminLog.create({
        data: {
          adminId: req.user!.id,
          action: 'ORDER_REFUND',
          targetType: 'Order',
          targetId: id,
          details: { reason, amount: order.charge },
        },
      }),
    ]);

    logger.info(`Order refunded by admin: ${id}`);

    res.json({ success: true, message: 'Order refunded' });
  } catch (error) {
    next(error);
  }
});

// Get deposit requests
router.get('/deposit-requests', async (req: AuthRequest, res, next) => {
  try {
    const { status = 'PENDING' } = req.query;

    const where: any = {};
    if (status !== 'all') {
      where.status = status;
    }

    const requests = await prisma.depositRequest.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true, balance: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

// Approve/Reject deposit request
router.post('/deposit-requests/:id/:action', async (req: AuthRequest, res, next) => {
  try {
<<<<<<< HEAD
    const id = req.params.id as string;
    const action = req.params.action as string;
=======
    const id = String(req.params.id);
    const action = String(req.params.action);
>>>>>>> 73d6501 (Fix build + improve server script)
    const { adminNote } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      throw new AppError(400, 'Invalid action');
    }

    const request = await prisma.depositRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw new AppError(404, 'Deposit request not found');
    }

    if (request.status !== 'PENDING') {
      throw new AppError(400, 'Request already processed');
    }

    if (action === 'approve') {
      await prisma.$transaction([
        prisma.depositRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            processedAt: new Date(),
            processedById: req.user!.id,
            adminNote: adminNote as string | undefined,
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
            description: `Deposit approved`,
          },
        }),
      ]);
    } else {
      await prisma.depositRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          processedById: req.user!.id,
          adminNote: adminNote as string | undefined,
        },
      });
    }

    logger.info(`Deposit request ${action}d: ${id}`);

    res.json({ success: true, message: `Request ${action}d` });
  } catch (error) {
    next(error);
  }
});

// Get all services (admin)
router.get('/services', async (req: AuthRequest, res, next) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: [{ isActive: 'desc' }, { platform: 'asc' }, { id: 'asc' }],
    });

    res.json({ services });
  } catch (error) {
    next(error);
  }
});

// Update service
router.patch('/services/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, price, title, description } = req.body;

    const service = await prisma.service.update({
      where: { id: Number(id) },
      data: {
        ...(typeof isActive === 'boolean' && { isActive }),
        ...(price && { price: Number(price) }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
      },
    });

    res.json({ service });
  } catch (error) {
    next(error);
  }
});

// Sync services from provider
router.post('/sync-services', async (req: AuthRequest, res, next) => {
  try {
    const { providerKey = 'SMMKINGS' } = req.body;

    const result = await syncServicesFromProvider(providerKey);

    // Invalidate services cache after sync
    invalidateServicesCache();

    logger.info(`Services synced: ${providerKey}`, result);

    res.json({
      success: true,
      message: `Synced ${result.created} new, updated ${result.updated} services`,
      cacheInvalidated: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

// Get admin logs
router.get('/logs', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', pageSize = '50' } = req.query;

    const logs = await prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Number(pageSize),
      skip: (Number(page) - 1) * Number(pageSize),
    });

    res.json({ logs });
  } catch (error) {
    next(error);
  }
});

export default router;
