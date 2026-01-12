import { Router } from 'express';
import prisma from '../utils/prisma';

const router = Router();

// Get all active services
router.get('/', async (req, res, next) => {
  try {
    const { platform, subCategory, search, page = '1', pageSize = '100' } = req.query;

    const where: any = { isActive: true };

    if (platform) {
      where.OR = [
        { platform: platform as string },
        { platforms: { has: platform as string } },
      ];
    }

    if (subCategory) {
      where.subCategory = subCategory;
    }

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { title: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [services, total] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy: [{ platform: 'asc' }, { subCategory: 'asc' }, { name: 'asc' }],
        take: Number(pageSize),
        skip: (Number(page) - 1) * Number(pageSize),
      }),
      prisma.service.count({ where }),
    ]);

    res.json({
      services,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    next(error);
  }
});

// Get service by ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id: Number(id) },
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({ service });
  } catch (error) {
    next(error);
  }
});

// Get service metadata (platforms, subcategories)
router.get('/meta/platforms', async (req, res, next) => {
  try {
    const platforms = await prisma.service.groupBy({
      by: ['platform'],
      where: { isActive: true, platform: { not: null } },
      _count: { platform: true },
    });

    const subCategories = await prisma.service.groupBy({
      by: ['subCategory', 'platform'],
      where: { isActive: true, subCategory: { not: null } },
      _count: { subCategory: true },
    });

    res.json({
      platforms: platforms.map((p) => p.platform).filter(Boolean),
      subCategories: subCategories.map((s) => ({
        platform: s.platform,
        subCategory: s.subCategory,
        count: s._count.subCategory,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
