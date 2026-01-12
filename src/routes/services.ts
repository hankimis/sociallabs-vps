import { Router } from 'express';
import prisma from '../utils/prisma';

const router = Router();

// ========== Types ==========
type ServicesListItem = {
  id: number;
  name: string;
  title: string | null;
  category: string;
  type: string;
  price: number;
  min: number;
  max: number;
  platform: string | null;
  platforms: string[];
  subCategory: string | null;
};

type PlatformConfig = { platforms: { name: string; subCategories: string[] }[] };
type ServicesResp = { items: ServicesListItem[]; platformConfig: PlatformConfig };
type CacheEntry = { ts: number; data: ServicesResp };
type ServiceDetailCache = { ts: number; data: any };

// ========== In-Memory Cache ==========
const SERVICES_CACHE_TTL_MS = 10_000; // 10 seconds
const SERVICE_DETAIL_CACHE_TTL_MS = 15_000; // 15 seconds
let servicesCache: CacheEntry | null = null;
const serviceDetailCache = new Map<number, ServiceDetailCache>();

// ========== Default Platforms ==========
const DEFAULT_PLATFORMS = [
  "추천서비스",
  "이벤트",
  "상위노출",
  "인스타그램",
  "유튜브",
  "페이스북",
  "틱톡",
  "스레드",
  "트위터",
  "디스코드",
  "텔레그램",
  "사운드 클라우드",
  "스포티파이",
  "아프리카티비",
  "트래픽",
];

// ========== Helper Functions ==========
function normalizeConfig(input: unknown): PlatformConfig {
  const obj = input && typeof input === "object" ? (input as { platforms?: unknown }) : {};
  const platformsIn = Array.isArray(obj.platforms) ? obj.platforms : [];
  const platforms = platformsIn
    .map((p) => {
      const po = p && typeof p === "object" ? (p as { name?: unknown; subCategories?: unknown }) : {};
      const name = String(po.name || "").trim();
      const subIn = Array.isArray(po.subCategories) ? po.subCategories : [];
      const subCategories = subIn.map((s) => String(s || "").trim()).filter((s) => s.length > 0);
      return { name, subCategories: Array.from(new Set(subCategories)) };
    })
    .filter((p) => p.name.length > 0);

  const seen = new Set<string>();
  const deduped = platforms.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  return { platforms: deduped };
}

// ========== Routes ==========

// Get all active services with caching and platform config
router.get('/', async (req, res, next) => {
  try {
    // Check cache first
    if (servicesCache && Date.now() - servicesCache.ts < SERVICES_CACHE_TTL_MS) {
      res.set('Cache-Control', 'private, max-age=5, stale-while-revalidate=30');
      return res.json(servicesCache.data);
    }

    // Fetch services with only necessary fields
    const services = await prisma.service.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        title: true,
        category: true,
        type: true,
        price: true,
        min: true,
        max: true,
        platform: true,
        platforms: true,
        subCategory: true,
      },
      orderBy: { id: 'asc' },
    });

    // Get platform config from AppSetting
    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const platformConfig: PlatformConfig = settings.platformConfig
      ? normalizeConfig(settings.platformConfig)
      : { platforms: DEFAULT_PLATFORMS.map((name) => ({ name, subCategories: [] })) };

    const data: ServicesResp = { items: services, platformConfig };

    // Update cache
    servicesCache = { ts: Date.now(), data };

    res.set('Cache-Control', 'private, max-age=5, stale-while-revalidate=30');
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get service by ID with caching
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid service ID' });
    }

    // Check cache first
    const cached = serviceDetailCache.get(id);
    if (cached && Date.now() - cached.ts < SERVICE_DETAIL_CACHE_TTL_MS) {
      res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
      return res.json(cached.data);
    }

    const service = await prisma.service.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        category: true,
        type: true,
        price: true,
        min: true,
        max: true,
        platform: true,
        platforms: true,
        subCategory: true,
        isActive: true,
      },
    });

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Update cache
    serviceDetailCache.set(id, { ts: Date.now(), data: service });

    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30');
    res.json(service);
  } catch (error) {
    next(error);
  }
});

// Get service metadata (platforms, subcategories)
router.get('/meta/platforms', async (req, res, next) => {
  try {
    // Get platform config from AppSetting
    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    const platformConfig: PlatformConfig = settings.platformConfig
      ? normalizeConfig(settings.platformConfig)
      : { platforms: DEFAULT_PLATFORMS.map((name) => ({ name, subCategories: [] })) };

    // Also get dynamic counts from database
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
      platformConfig,
      platforms: platforms.map((p) => ({
        name: p.platform,
        count: p._count.platform,
      })).filter((p) => p.name),
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

// Search services with filtering
router.get('/search', async (req, res, next) => {
  try {
    const {
      platform,
      subCategory,
      search,
      page = '1',
      pageSize = '50'
    } = req.query;

    const where: any = { isActive: true };

    if (platform && platform !== 'all') {
      where.OR = [
        { platform: platform as string },
        { platforms: { has: platform as string } },
      ];
    }

    if (subCategory) {
      where.subCategory = subCategory;
    }

    if (search) {
      const searchStr = search as string;
      where.AND = [
        {
          OR: [
            { name: { contains: searchStr, mode: 'insensitive' } },
            { title: { contains: searchStr, mode: 'insensitive' } },
            { category: { contains: searchStr, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [services, total] = await Promise.all([
      prisma.service.findMany({
        where,
        select: {
          id: true,
          name: true,
          title: true,
          category: true,
          type: true,
          price: true,
          min: true,
          max: true,
          platform: true,
          platforms: true,
          subCategory: true,
        },
        orderBy: { id: 'asc' },
        take: Number(pageSize),
        skip: (Number(page) - 1) * Number(pageSize),
      }),
      prisma.service.count({ where }),
    ]);

    res.json({
      items: services,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / Number(pageSize)),
    });
  } catch (error) {
    next(error);
  }
});

// Invalidate cache (for admin use after sync)
router.post('/cache/invalidate', async (req, res, next) => {
  try {
    invalidateCache();
    res.json({ success: true, message: 'Cache invalidated' });
  } catch (error) {
    next(error);
  }
});

// Export cache invalidation function for use by other modules
export function invalidateCache() {
  servicesCache = null;
  serviceDetailCache.clear();
}

export default router;
