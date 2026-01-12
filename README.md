시작방법
.\server.ps1 install   # 설치
.\server.ps1 start     # 시작

# Sociallabs VPS Backend

Express.js API server for Sociallabs SMM Panel.

## Requirements

- Node.js 18+
- npm or yarn
- PM2 (for production)
- PostgreSQL database

## Installation

### Windows

```powershell
# Install dependencies and build
.\server.ps1 install

# Or using batch file
server.bat install
```

### Linux/Mac

```bash
npm install
npm run prisma:generate
npm run build
```

## Configuration

1. Copy `.env.example` to `.env`
2. Configure your environment variables:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sociallabs"
DIRECT_URL="postgresql://user:password@localhost:5432/sociallabs"

# Server
PORT=4000
NODE_ENV=production

# JWT Secret (generate a strong random string)
JWT_SECRET=your-super-secret-jwt-key

# CORS (your Vercel frontend URL)
CORS_ORIGIN=https://your-app.vercel.app

# SMM Panel APIs
SMMKINGS_API_URL=https://smmkings.com/api/v2
SMMKINGS_API_KEY=your-api-key
```

## Running the Server

### Development

```bash
npm run dev
```

### Production (PM2)

#### Windows

```powershell
# Start
.\server.ps1 start

# Stop
.\server.ps1 stop

# Restart
.\server.ps1 restart

# View logs
.\server.ps1 logs

# Full deploy (build + restart)
.\server.ps1 deploy
```

#### Linux/Mac

```bash
pm2 start ecosystem.config.js
pm2 save
```

## Auto-start on Boot

### Windows

```powershell
pm2 startup
pm2 save
```

### Linux

```bash
pm2 startup systemd
pm2 save
```

## API Endpoints

### Auth
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/verify` - Verify token

### User
- `GET /api/user/me` - Get current user
- `GET /api/user/transactions` - Get transactions
- `POST /api/user/deposit-requests` - Create deposit request
- `GET /api/user/tickets` - Get tickets

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/list` - Get user orders
- `POST /api/orders/:id/cancel` - Cancel order

### Services
- `GET /api/services` - Get active services
- `GET /api/services/:id` - Get service by ID
- `GET /api/services/meta/platforms` - Get platform metadata

### Admin
- `GET /api/admin/users` - Get all users
- `GET /api/admin/orders` - Get all orders
- `POST /api/admin/orders/:id/refund` - Refund order
- `GET /api/admin/deposit-requests` - Get deposit requests
- `POST /api/admin/deposit-requests/:id/:action` - Approve/reject deposit
- `GET /api/admin/services` - Get all services
- `PATCH /api/admin/services/:id` - Update service
- `POST /api/admin/sync-services` - Sync services from provider

### Agent
- `GET /api/agent/me` - Get agent profile
- `POST /api/agent/apply` - Apply for agent
- `GET /api/agent/stats` - Get agent stats
- `POST /api/agent/generate-code` - Generate referral code

## Health Check

```
GET /health
```

Returns server status and uptime.

## Background Jobs

The server runs these background jobs:
- **Order Status Sync**: Every 5 minutes, syncs order statuses from SMM providers
- **Log Cleanup**: Daily at 3 AM, removes logs older than 30 days

## Logs

Logs are stored in the `logs/` directory:
- `error.log` - Error logs only
- `out.log` - Standard output
- `combined.log` - All logs
# sociallabs-vps
