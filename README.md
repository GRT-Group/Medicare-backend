# Medicare Backend API

A complete healthcare and pharmacy ERP system backend built with Next.js, TypeScript, and Prisma.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
```bash
# Copy example env file
cp .env.example .env

# Edit .env with your configuration
```

### 3. Database Setup
```bash
# Run migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Seed initial data
# (Check package.json for seed scripts)
```

### 4. Start Development Server
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

---

## 📚 Documentation

### Essential Guides
- **`APP_API.md`** - Complete API reference organized by sidebar and role
- **`auth.md`** - Authentication flow and subscription management
- **`FRONTEND_INTEGRATION.md`** - Frontend integration guide with React hooks
- **`SETUP_CHECKLIST.md`** - Complete setup and testing checklist

### Quick API Reference
- **Health Check:** `GET /api/health`
- **API Root:** `GET /`
- **Register:** `POST /api/auth/register`
- **Login:** `POST /api/auth/login`
- **Dashboard:** `GET /api/dashboard`

### Postman Collection
Import `medicare-postman-collection.json` into Postman for easy testing.

---

## 🔧 Frontend Integration

### Files to Copy
Copy these files to your frontend project:
```
src/lib/api/
├── index.ts          # Barrel file
├── types.ts          # TypeScript types
├── client.ts         # API client
└── hooks.ts          # React hooks
```

### Quick Example
```typescript
import { api, useAuth } from '@/lib/api'

// Login
const result = await api.login({
  identifier: 'john@example.com',
  password: 'SecurePassword123!'
})

// In React
function App() {
  const { user, isAuthenticated } = useAuth()
  // ...
}
```

See `FRONTEND_INTEGRATION.md` for complete guide.

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Auth:** JWT + bcrypt
- **Email:** Nodemailer
- **Storage:** Supabase (optional)

---

## 📦 Features

### Authentication & Users
- ✅ Multi-step registration
- ✅ OTP-based login
- ✅ Password reset flow
- ✅ User profile management
- ✅ Notification preferences (SMS/Email)
- ✅ JWT token authentication

### Organization Management
- ✅ Multi-tenant architecture
- ✅ Organization types
- ✅ Branch management
- ✅ Subscription system

### Inventory & Products
- ✅ Product catalog
- ✅ Batch tracking
- ✅ Inventory management
- ✅ Stock transfers
- ✅ Reorder suggestions

### Sales & Purchases
- ✅ Point of Sale (POS)
- ✅ Customer management
- ✅ Supplier management
- ✅ Sales history
- ✅ Purchase orders

### Financial
- ✅ Cash sessions
- ✅ Cashbook
- ✅ Customer payments
- ✅ Expense tracking

### Dashboard & Reporting
- ✅ Real-time dashboard
- ✅ Sales analytics
- ✅ Low stock alerts
- ✅ Expiry tracking

### Admin Features
- ✅ Admin dashboard
- ✅ Organization approval
- ✅ Subscription management
- ✅ Payment approval

---

## 🔐 Authentication Flow

```
1. User registers → Organization created
2. User logs in with credentials
3. OTP sent via SMS/Email (based on preferences)
4. User enters OTP
5. JWT token issued
6. Token used for authenticated requests
```

See `auth.md` for detailed flow.

---

## 📋 Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
```

---

## 🗂️ Project Structure

```
medicare-backend/
├── src/
│   ├── app/
│   │   └── api/              # API routes
│   ├── lib/
│   │   ├── api/              # Frontend integration files
│   │   ├── prisma.ts
│   │   └── supabase/
│   ├── services/             # Business logic
│   └── scripts/              # Utility scripts
├── prisma/
│   ├── schema.prisma
│   └── seed-*.ts
├── APP_API.md
├── auth.md
├── FRONTEND_INTEGRATION.md
├── SETUP_CHECKLIST.md
└── package.json
```

---

## 🤝 Need Help?

1. **Setup:** Follow `SETUP_CHECKLIST.md`
2. **API Reference:** See `APP_API.md`
3. **Authentication:** See `auth.md`
4. **Frontend Integration:** See `FRONTEND_INTEGRATION.md`
5. **Testing:** Use Postman collection

---

## 📄 License

Copyright © 2024 Medicare. All rights reserved.



