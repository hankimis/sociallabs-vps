import { Router } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest, agentMiddleware } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';

const router = Router();

// Get agent profile
router.get('/me', async (req: AuthRequest, res, next) => {
  try {
    const profile = await prisma.agentProfile.findUnique({
      where: { userId: req.user!.id },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        referralCode: true,
        balance: true,
      },
    });

    res.json({
      profile,
      referralCode: user?.referralCode,
      balance: user?.balance,
    });
  } catch (error) {
    next(error);
  }
});

// Apply for agent
router.post('/apply', async (req: AuthRequest, res, next) => {
  try {
    const {
      message,
      applicantName,
      phone,
      payoutBankName,
      payoutBankAccount,
      payoutAccountHolder,
    } = req.body;

    // Check if already agent
    if (req.user!.role === 'AGENT') {
      throw new AppError(400, 'Already an agent');
    }

    // Check existing application
    const existingApplication = await prisma.agentApplication.findFirst({
      where: {
        userId: req.user!.id,
        status: 'PENDING',
      },
    });

    if (existingApplication) {
      throw new AppError(400, 'You already have a pending application');
    }

    const application = await prisma.agentApplication.create({
      data: {
        userId: req.user!.id,
        message,
        applicantName,
        phone,
        payoutBankName,
        payoutBankAccount,
        payoutAccountHolder,
        consentPersonalInfo: true,
        consentAt: new Date(),
      },
    });

    res.status(201).json({ application });
  } catch (error) {
    next(error);
  }
});

// Agent stats (protected)
router.get('/stats', agentMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const profile = await prisma.agentProfile.findUnique({
      where: { userId: req.user!.id },
    });

    if (!profile) {
      throw new AppError(404, 'Agent profile not found');
    }

    // Get orders with agent code
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { referralCode: true },
    });

    if (!user?.referralCode) {
      throw new AppError(400, 'No referral code');
    }

    const orders = await prisma.order.findMany({
      where: { agentCodeApplied: user.referralCode },
      select: {
        id: true,
        charge: true,
        agentCommission: true,
        status: true,
        createdAt: true,
      },
    });

    const totalOrders = orders.length;
    const totalCommission = orders.reduce(
      (sum, o) => sum + (o.agentCommission || 0),
      0
    );

    // Get referred users
    const referredUsers = await prisma.user.count({
      where: { referredBy: user.referralCode },
    });

    res.json({
      profile,
      stats: {
        totalOrders,
        totalCommission,
        referredUsers,
        commissionRate: profile.commissionRate,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Generate referral code
router.post('/generate-code', agentMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (user?.referralCode) {
      return res.json({ referralCode: user.referralCode });
    }

    // Generate unique code
    const code = `AG${Date.now().toString(36).toUpperCase()}`;

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { referralCode: code },
    });

    res.json({ referralCode: code });
  } catch (error) {
    next(error);
  }
});

// Get agent's referred users
router.get('/users', agentMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { referralCode: true },
    });

    if (!user?.referralCode) {
      return res.json({ users: [] });
    }

    const users = await prisma.user.findMany({
      where: { referredBy: user.referralCode },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

export default router;
