// @ts-nocheck
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { smsSend } from './sms.service'
import { PermissionService } from './permission.service'
import { JWT_SECRET } from '@/lib/auth-utils'
import { issueFlowToken } from '@/lib/flow-token'

const MAX_OTP_ATTEMPTS = 5
const OTP_RESEND_COOLDOWN_SECONDS = 30

// Both flows send a LOGIN_2FA-type code (the OTP page only ever verifies
// that type - see the register route), so `type` alone can't tell them
// apart. Each caller states its own intended lifetime instead:
// - a returning user logging in should have a short-lived, high-urgency
//   code (5 minutes) since they're mid-session and expected to act fast.
// - a freshly registered account's first verification code gets a longer
//   window (1 hour) since they may still be reading a welcome email,
//   choosing a plan, etc. before coming back to verify.
const LOGIN_OTP_TTL_MINUTES = 5
const REGISTRATION_OTP_TTL_MINUTES = 60

export class AuthService {
  /**
   * Register a new Organization and its Owner user
   */
  static async registerTenant(data: {
    organizationName: string
    organizationTypeId: bigint
    firstName: string
    lastName: string
    email: string
    phone: string
    password: string
    businessUnit?: string
    taxId?: string
    registrationNumber?: string
    licenseNumber?: string
    website?: string
    address?: object
    country?: string
    timezone?: string
    currency?: string
    businessLicenseUrl?: string
  }) {
    // All of these uniqueness/lookup checks are independent of each other,
    // so run them concurrently instead of as ~8 sequential round-trips -
    // each one pays the same network latency to the DB, and doing them one
    // at a time was the main reason registration took 10-15+ seconds.
    const generatedCode = 'ORG-' + crypto.randomBytes(3).toString('hex').toUpperCase()

    const [
      existingOrgName,
      existingEmail,
      existingPhone,
      existingTax,
      existingReg,
      existingLic,
      existingOrgCode,
      ownerRole,
    ] = await Promise.all([
      prisma.organization.findFirst({ where: { name: data.organizationName } }),
      prisma.user.findUnique({ where: { email: data.email } }),
      data.phone ? prisma.user.findFirst({ where: { phone: data.phone } }) : Promise.resolve(null),
      data.taxId ? prisma.organization.findFirst({ where: { tax_id: data.taxId } }) : Promise.resolve(null),
      data.registrationNumber ? prisma.organization.findFirst({ where: { registration_number: data.registrationNumber } }) : Promise.resolve(null),
      data.licenseNumber ? prisma.organization.findFirst({ where: { license_number: data.licenseNumber } }) : Promise.resolve(null),
      prisma.organization.findUnique({ where: { code: generatedCode } }),
      prisma.userRole.findUnique({ where: { name: 'Administrator' } }),
    ])

    if (existingOrgName) {
      throw new Error('This organization name is already registered in the system.')
    }
    if (existingEmail) {
      throw new Error('This email is already registered in the system.')
    }
    if (existingPhone) {
      throw new Error('This phone number is already registered in the system.')
    }
    if (existingTax) {
      throw new Error('This TIN/Tax ID is already registered in the system. Please use a different one.')
    }
    if (existingReg) {
      throw new Error('This Registration Number is already registered in the system. Please use a different one.')
    }
    if (existingLic) {
      throw new Error('This License Number is already registered in the system. Please use a different one.')
    }
    if (!ownerRole) {
      throw new Error('System setup incomplete: Administrator role not found.')
    }

    // A random 3-byte hex code colliding with an existing one is extremely
    // rare (~1 in 16 million); only pay for a retry round-trip on that rare
    // collision instead of always blocking on it up front.
    let finalCode = generatedCode
    if (existingOrgCode) {
      let isCodeUnique = false
      while (!isCodeUnique) {
        finalCode = 'ORG-' + crypto.randomBytes(3).toString('hex').toUpperCase()
        const retryCollision = await prisma.organization.findUnique({ where: { code: finalCode } })
        isCodeUnique = !retryCollision
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 10)

    // Execute in transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const org = await tx.organization.create({
        data: {
          name: data.organizationName,
          code: finalCode,
          organization_type_id: data.organizationTypeId,
          phone: data.phone,
          email: data.email, // using same email for org contact
          business_unit: data.businessUnit,
          tax_id: data.taxId,
          registration_number: data.registrationNumber,
          license_number: data.licenseNumber,
          website: data.website,
          country: data.country,
          timezone: data.timezone || 'UTC',
          currency: data.currency || 'RWF',
          business_license_url: data.businessLicenseUrl,
          address: data.address ? (data.address as any) : undefined,
        },
      })

      // 2. Create User
      const user = await tx.user.create({
        data: {
          organization_id: org.id,
          email: data.email,
          first_name: data.firstName,
          last_name: data.lastName,
          phone: data.phone,
          password_hash: passwordHash,
          role_id: ownerRole.id,
          status: 'PENDING_ONBOARDING',
        },
      })

      // Friendly public identifier shown in the UI instead of the raw
      // database id (e.g. MC-000123). Deterministic from the real id, so
      // no uniqueness-retry loop is needed unlike the random org code above.
      const publicUser = await tx.user.update({
        where: { id: user.id },
        data: { public_id: `MC-${String(user.id).padStart(6, '0')}` },
      })

      return { org, user: publicUser }
    })

    // Send Welcome Email and SMS Notification asynchronously
    const frontendUrl = process.env.FRONTEND_URL || 'https://medicare.futureinnovatech.rw'
    const subscriptionLink = `${frontendUrl}/subscription`
    EmailService.sendWelcomeEmail(result.user.email, result.org.name, subscriptionLink).catch(console.error)
    smsSend({
      phone: result.org.phone,
      message: `Welcome to Medicare System! Your organization ${result.org.name} has been created successfully. Check your email for details.`
    }).catch(console.error)

    return result
  }

  /**
   * Super Admin provisions a tenant
   */
  static async adminProvisionTenant(
    adminId: bigint,
    data: {
      organizationName: string
      organizationTypeId: bigint
      firstName: string
      lastName: string
      email: string
      phone: string
      password: string
    }
  ) {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true, role_id: true }
    })

    if (!admin) {
      throw new Error('Unauthorized: admin account not found.')
    }

    if (!PermissionService.isSuperAdmin(admin.role_id)) {
      throw new Error('Forbidden: Only Super Admin can provision organizations.')
    }

    return this.registerTenant(data)
  }

  /**
   * Add a new user to an existing organization and send login credentials
   */
  static async addUserToOrganization({
    organizationId,
    adminId,
    firstName,
    lastName,
    email,
    phone,
    roleId,
  }: {
    organizationId: bigint;
    adminId: bigint;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    roleId: bigint;
  }) {
    // 1. Verify admin belongs to the org and has permission (in a real app check permissions)
    const admin = await prisma.user.findFirst({
      where: { id: adminId, organization_id: organizationId }
    })
    if (!admin) throw new Error("Unauthorized to add user to this organization.");

    // 2. Check if user email already exists
    const existingEmail = await prisma.user.findUnique({ where: { email } })
    if (existingEmail) throw new Error("This email is already registered in the system.");

    if (phone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone } })
      if (existingPhone) throw new Error("This phone number is already registered in the system.");
    }

    // 3. Auto-generate secure password (e.g. Med@Random1234!)
    const autoGeneratedPassword = `Med@${Math.floor(1000 + Math.random() * 9000)}!`
    const passwordHash = await bcrypt.hash(autoGeneratedPassword, 10)

    // 4. Create user
    const createdUser = await prisma.user.create({
      data: {
        organization_id: organizationId,
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        password_hash: passwordHash,
        role_id: roleId,
        status: 'PENDING_ONBOARDING', // Will activate when they verify
      }
    })

    const newUser = await prisma.user.update({
      where: { id: createdUser.id },
      data: { public_id: `MC-${String(createdUser.id).padStart(6, '0')}` },
    })

    const org = await prisma.organization.findUnique({ where: { id: organizationId } })

    // 5. Send Email with auto-generated credentials and a verification OTP/link
    const emailBody = `
      <h2>Welcome to ${org?.name || 'Medicare System'}</h2>
      <p>Hello ${firstName}, an account has been created for you by your administrator.</p>
      <p>Your temporary password is: <b>${autoGeneratedPassword}</b></p>
      <p>Please log in and you will be prompted to verify your email.</p>
    `;
    await EmailService.sendEmail(email, "Your Medicare System Account Credentials", emailBody, `Your password is: ${autoGeneratedPassword}`)
      .catch(console.error);

    return newUser;
  }

  /**
   * Login Step 1: Verify credentials and send OTP
   */
  static async login(identifier: string, password: string) {
    // 1. Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier },
          { public_id: identifier }
        ]
      },
      include: { role: true }
    })
    if (!user) throw new Error('Invalid credentials')

    const isValid = await bcrypt.compare(password, user.password_hash)
    if (!isValid) throw new Error('Invalid credentials')

    if (user.status !== 'ACTIVE' && user.status !== 'PENDING_ONBOARDING') {
      throw new Error(`Account is ${user.status}. Please contact support.`)
    }

    // 2. Send OTP - short 5-minute window since this is a returning,
    // already-mid-session login (vs. registration's longer 1-hour window).
    const { expiresAt } = await this.sendOtp(user.id, user.email, user.phone || undefined, 'LOGIN_2FA', LOGIN_OTP_TTL_MINUTES)

    // 3. Issue a short-lived flow token proving this browser just completed
    // a real login, so verify-otp can require it instead of trusting a
    // bare userId + code.
    const flowToken = issueFlowToken({
      userId: user.id,
      organizationId: user.organization_id ?? undefined,
      step: 'verify-otp',
    })

    return {
      requireOtp: true,
      userId: user.id,
      user,
      otpExpiresAt: expiresAt,
      flowToken,
      message: 'An OTP has been sent to your email and phone.'
    }
  }

  /**
   * Login Step 2: Verify OTP and generate session
   */
  static async verifyLoginOtp(userId: bigint, code: string, ipAddress?: string, userAgent?: string) {
    // 1. Verify the OTP code
    await this.verifyOtp(userId, code, 'LOGIN_2FA')

    // 2. Fetch the user
    // 2. Fetch the user with their Role included
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true } // Assuming the relation is named 'role'
    })
    if (!user) throw new Error('User not found.')

    // 3. Generate Session/JWT Token
    const payload = {
      id: user.id.toString(),
      email: user.email,
      role_id: user.role_id.toString(),
      organization_id: user.organization_id?.toString(),
    }
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })

    // 4. Save session in database
    await prisma.userSession.create({
      data: {
        user_id: user.id,
        organization_id: user.organization_id,
        session_token: token,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        ip_address: ipAddress,
        user_agent: userAgent,
        status: 'ACTIVE',
      },
    })

    return { user, token }
  }

  /**
   * Generate and Send OTP
   */
  static async sendOtp(
    userId: bigint,
    email: string,
    phone: string | undefined,
    type: 'LOGIN_2FA' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    ttlMinutes: number = LOGIN_OTP_TTL_MINUTES
  ) {
    // The cooldown lookup and the contact-info lookup are independent
    // reads, so run them together instead of one after another - each
    // round-trip to the DB has fixed network latency, so halving the
    // number of sequential round-trips roughly halves this wait.
    const [lastToken, user] = await Promise.all([
      // Reject rapid-fire resend spam (which would otherwise let an
      // attacker race fresh codes while brute-forcing an old one, or just
      // flood the user's inbox/phone).
      prisma.verificationToken.findFirst({
        where: { user_id: userId, type },
        orderBy: { created_at: 'desc' },
      }),
      // Resolve contact details from the DB record rather than trusting
      // the caller's params, so callers (like an OTP resend) that only
      // have a userId can still reach the user on every channel their
      // preferences allow, instead of falling back to email-only.
      prisma.user.findUnique({
        where: { id: userId },
        select: { first_name: true, last_name: true, email: true, phone: true }
      }),
    ])

    if (lastToken) {
      const secondsSinceLast = (Date.now() - lastToken.created_at.getTime()) / 1000
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)
        throw new Error(`Please wait ${wait}s before requesting another code.`)
      }
    }

    // Generate a 6 digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()

    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)

    // Store in database
    await prisma.verificationToken.create({
      data: {
        user_id: userId,
        code,
        type,
        expires_at: expiresAt,
        is_used: false,
        status: 'ACTIVE',
      },
    })

    // Dispatch email/SMS in the background rather than blocking the HTTP
    // response on a third-party API call (Resend/HDEV) - the code is
    // already durably stored above, so the caller ("check your email")
    // doesn't need to wait for the send to actually complete, only for it
    // to have been queued. This was previously awaited here, which made
    // register/login take 10+ seconds dominated by the email round-trip.
    NotificationService.sendOtp(
      userId,
      user?.email || email,
      user?.phone || phone,
      code,
      type,
      user?.first_name,
      user?.last_name
    ).catch((notifyError) => {
      console.error('Failed to send OTP notification', notifyError)
    })

    // Returned so the frontend can show a live "code expires in..."
    // countdown instead of a fixed/guessed duration.
    return { expiresAt }
  }

  /**
   * Verify OTP
   */
  static async verifyOtp(userId: bigint, code: string, type: 'LOGIN_2FA' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
    // Look up the active (unused, unexpired, not locked-out) token for this
    // user/type regardless of whether the submitted code matches, so a wrong
    // guess can still increment its attempt counter.
    const activeToken = await prisma.verificationToken.findFirst({
      where: {
        user_id: userId,
        type,
        is_used: false,
        status: 'ACTIVE',
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    })

    if (!activeToken) {
      throw new Error('Invalid or expired verification code.')
    }

    if (activeToken.attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.verificationToken.update({
        where: { id: activeToken.id },
        data: { status: 'LOCKED' },
      })
      throw new Error('Too many incorrect attempts. Please request a new code.')
    }

    if (activeToken.code !== code) {
      await prisma.verificationToken.update({
        where: { id: activeToken.id },
        data: { attempts: { increment: 1 } },
      })
      const remaining = MAX_OTP_ATTEMPTS - (activeToken.attempts + 1)
      if (remaining <= 0) {
        await prisma.verificationToken.update({
          where: { id: activeToken.id },
          data: { status: 'LOCKED' },
        })
        throw new Error('Too many incorrect attempts. Please request a new code.')
      }
      throw new Error(`Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`)
    }

    // Mark as used
    await prisma.verificationToken.update({
      where: { id: activeToken.id },
      data: { is_used: true },
    })

    return true
  }
}


