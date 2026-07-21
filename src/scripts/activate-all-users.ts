/**
 * Script to activate ALL users and organizations in the database.
 * 
 * This sets:
 * - All users' status to 'ACTIVE'
 * - All organizations' lifecycle_status to 'ACTIVE'
 * 
 * So that every user can log in without any activation blockers.
 * 
 * Usage: npx tsx src/scripts/activate-all-users.ts
 */

import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Starting activation of all users and organizations...\n')

  // 1. Activate all organizations (set lifecycle_status to ACTIVE)
  const orgResult = await prisma.organization.updateMany({
    where: {
      lifecycle_status: {
        not: 'ACTIVE'
      }
    },
    data: {
      lifecycle_status: 'ACTIVE'
    }
  })
  console.log(`✅ Activated ${orgResult.count} organization(s) (lifecycle_status → ACTIVE)`)

  // 2. Activate all users (set status to ACTIVE)
  const userResult = await prisma.user.updateMany({
    where: {
      status: {
        not: 'ACTIVE'
      }
    },
    data: {
      status: 'ACTIVE'
    }
  })
  console.log(`✅ Activated ${userResult.count} user(s) (status → ACTIVE)`)

  // 3. Show specific user jean.bihira1@gmail.com
  const jeanUser = await prisma.user.findUnique({
    where: { email: 'jean.bihira1@gmail.com' },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      status: true,
      organization: {
        select: {
          name: true,
          lifecycle_status: true
        }
      }
    }
  })

  if (jeanUser) {
    console.log(`\n📋 User jean.bihira1@gmail.com:`)
    console.log(`   Name: ${jeanUser.first_name} ${jeanUser.last_name}`)
    console.log(`   Status: ${jeanUser.status}`)
    console.log(`   Organization: ${jeanUser.organization?.name || 'N/A'}`)
    console.log(`   Org Status: ${jeanUser.organization?.lifecycle_status || 'N/A'}`)
  } else {
    console.log(`\n⚠️  User jean.bihira1@gmail.com was NOT found in the database.`)
  }

  // 4. Summary of all users
  const allUsers = await prisma.user.findMany({
    select: {
      email: true,
      status: true,
      first_name: true,
      last_name: true,
    },
    orderBy: { created_at: 'desc' }
  })
  
  console.log(`\n📊 All users in the system (${allUsers.length} total):`)
  allUsers.forEach((u, i) => {
    console.log(`   ${i + 1}. ${u.email} — ${u.first_name} ${u.last_name} — ${u.status}`)
  })

  console.log('\n🎉 Done! All users and organizations are now ACTIVE.')
}

main()
  .catch((err) => {
    console.error('❌ Error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
