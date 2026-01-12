import { Router } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';

const router = Router();

// Get current user
router.get('/me', async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        balance: true,
        referralCode: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Get user transactions
router.get('/transactions', async (req: AuthRequest, res, next) => {
  try {
    const { page = '1', pageSize = '50' } = req.query;

    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: Number(pageSize),
      skip: (Number(page) - 1) * Number(pageSize),
    });

    const total = await prisma.transaction.count({
      where: { userId: req.user!.id },
    });

    res.json({
      transactions,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    next(error);
  }
});

// Create deposit request
router.post('/deposit-requests', async (req: AuthRequest, res, next) => {
  try {
    const { amount, depositorName, memo } = req.body;

    if (!amount || !depositorName) {
      throw new AppError(400, 'Amount and depositor name required');
    }

    const depositRequest = await prisma.depositRequest.create({
      data: {
        userId: req.user!.id,
        amount: Number(amount),
        depositorName,
        memo: memo || null,
      },
    });

    res.status(201).json(depositRequest);
  } catch (error) {
    next(error);
  }
});

// Get user deposit requests
router.get('/deposit-requests', async (req: AuthRequest, res, next) => {
  try {
    const requests = await prisma.depositRequest.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ requests });
  } catch (error) {
    next(error);
  }
});

// Get user tickets
router.get('/tickets', async (req: AuthRequest, res, next) => {
  try {
    const tickets = await prisma.ticket.findMany({
      where: { userId: req.user!.id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ tickets });
  } catch (error) {
    next(error);
  }
});

// Create ticket
router.post('/tickets', async (req: AuthRequest, res, next) => {
  try {
    const { subject, message, category } = req.body;

    if (!subject || !message) {
      throw new AppError(400, 'Subject and message required');
    }

    const ticket = await prisma.ticket.create({
      data: {
        userId: req.user!.id,
        subject,
        category: category || 'GENERAL',
        messages: {
          create: {
            userId: req.user!.id,
            message,
            isAdmin: false,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
});

export default router;
