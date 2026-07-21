// @ts-nocheck
import { prisma } from '@/lib/prisma'
import { UserStatus } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PermissionService } from './permission.service'

export class UserService {
  /**
   * Get users. If organizationId is provided, filters by that organization.
   * Super Admins can call this without organizationId to fetch all users globally.
   */
  static async getUsers(organizationId?: bigint) {
    // Exclude soft-deleted users - they live in the recycle bin, not the
    // active list. Showing them caused bulk-delete to report them as
    // "failed" ("already deleted") when a user selected every row.
    const whereClause = organizationId
      ? { organization_id: organizationId, is_deleted: false }
      : { is_deleted: false }

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        role: true,
        organization: true
      },
      orderBy: {
        created_at: 'desc'
      }
    })

    // Batch-fetch permissions once per distinct role instead of running
    // PermissionService.getUserPermissions (a full nested query) once per
    // user - that serialized one extra round trip per row in the list.
    const distinctRoleIds = Array.from(new Set(users.map(u => u.role_id)))
    const hasSuperAdmin = distinctRoleIds.some(roleId => PermissionService.isSuperAdmin(roleId))

    const [allPermissions, rolePermissions] = await Promise.all([
      hasSuperAdmin ? prisma.permission.findMany({ where: { status: 'ACTIVE' } }) : Promise.resolve([]),
      prisma.rolePermission.findMany({
        where: {
          role_id: { in: distinctRoleIds },
          status: 'ACTIVE',
          ...(organizationId && { organization_id: organizationId })
        },
        include: { Permission: true }
      })
    ])

    const permissionsByRole = new Map<string, typeof allPermissions>()
    for (const rp of rolePermissions) {
      const key = rp.role_id.toString()
      if (!permissionsByRole.has(key)) permissionsByRole.set(key, [])
      permissionsByRole.get(key)!.push(rp.Permission)
    }

    return users.map(user => {
      // Omit password hash for security
      const { password_hash, ...safeUser } = user
      const isSuperAdmin = PermissionService.isSuperAdmin(user.role_id)
      return {
        ...safeUser,
        is_super_admin: isSuperAdmin,
        permissions: isSuperAdmin ? allPermissions : (permissionsByRole.get(user.role_id.toString()) || [])
      }
    })
  }

  /**
   * Get a single user by ID.
   */
  static async getUserById(userId: bigint) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        organization: {
          include: {
            Subscription: true
          }
        },
        Branch_User_branch_idToBranch: true
      }
    })

    if (!user) return null

    let finalUser = user;

    if (!finalUser.branch_id && finalUser.organization_id) {
      const branches = await prisma.branch.findMany({
        where: { organization_id: finalUser.organization_id, is_deleted: false },
        take: 2
      })
      if (branches.length === 1) {
        finalUser = await prisma.user.update({
          where: { id: finalUser.id },
          data: { branch_id: branches[0].id },
          include: {
            role: true,
            organization: {
              include: {
                Subscription: true
              }
            },
            Branch_User_branch_idToBranch: true
          }
        })
      }
    }

    const { password_hash, Branch_User_branch_idToBranch, ...safeUser } = finalUser
    const permissions = await PermissionService.getUserPermissions(finalUser.id, safeUser.organization_id)

    return {
      ...safeUser,
      branch: Branch_User_branch_idToBranch,
      is_super_admin: PermissionService.isSuperAdmin(finalUser.role_id),
      permissions
    }
  }

  /**
   * Admin-driven update of a target user's profile fields, role, and branch.
   * Authorization (who is allowed to call this for which target) is enforced by the caller.
   */
  static async updateUserByAdmin(userId: bigint, data: {
    first_name?: string
    last_name?: string
    phone?: string
    role_id?: bigint
    branch_id?: bigint | null
    status?: UserStatus
  }) {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
      include: {
        role: true,
        organization: true,
        Branch_User_branch_idToBranch: true
      }
    })

    const { password_hash, Branch_User_branch_idToBranch, ...safeUser } = updatedUser
    return { ...safeUser, branch: Branch_User_branch_idToBranch }
  }

  /**
   * Change user status
   */
  static async changeUserStatus(userId: bigint, status: UserStatus) {
    return prisma.user.update({
      where: { id: userId },
      data: { status },
      include: {
        organization: true,
        role: true
      }
    })
  }

  // ==========================================
  // PROFILE & SETTINGS
  // ==========================================

  static async updateProfile(userId: bigint, data: { first_name?: string, last_name?: string, phone?: string }) {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data
    });
    const { password_hash, ...safeUser } = updatedUser;
    return safeUser;
  }

  static async updateNotificationPreferences(userId: bigint, data: { 
    sms_notification_active?: boolean, 
    email_notification_active?: boolean,
    auth_sms_active?: boolean,
    auth_email_active?: boolean,
    system_sms_active?: boolean,
    system_email_active?: boolean
  }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    // Validate authentication preferences: can't disable both SMS and Email for auth
    const newAuthSms = data.auth_sms_active !== undefined ? data.auth_sms_active : user.auth_sms_active;
    const newAuthEmail = data.auth_email_active !== undefined ? data.auth_email_active : user.auth_email_active;
    if (!newAuthSms && !newAuthEmail) {
      throw new Error('You cannot disable both SMS and Email for authentication notifications at the same time.');
    }

    // Validate system preferences: can't disable both SMS and Email for system
    const newSystemSms = data.system_sms_active !== undefined ? data.system_sms_active : user.system_sms_active;
    const newSystemEmail = data.system_email_active !== undefined ? data.system_email_active : user.system_email_active;
    if (!newSystemSms && !newSystemEmail) {
      throw new Error('You cannot disable both SMS and Email for system notifications at the same time.');
    }

    // For backward compatibility, also update legacy fields if provided
    const newLegacySms = data.sms_notification_active !== undefined ? data.sms_notification_active : user.sms_notification_active;
    const newLegacyEmail = data.email_notification_active !== undefined ? data.email_notification_active : user.email_notification_active;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        sms_notification_active: newLegacySms,
        email_notification_active: newLegacyEmail,
        auth_sms_active: newAuthSms,
        auth_email_active: newAuthEmail,
        system_sms_active: newSystemSms,
        system_email_active: newSystemEmail
      }
    });

    const { password_hash, ...safeUser } = updatedUser;
    return safeUser;
  }

  static async requestPasswordChange(userId: bigint, oldPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const isValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isValid) throw new Error('Incorrect old password');

    // Dynamically import auth service to avoid circular dependency
    const { AuthService } = await import('@/services/auth.service');
    
    // Send OTP
    await AuthService.sendOtp(user.id, user.email, user.phone || undefined, 'PASSWORD_RESET');
    
    return { success: true, message: 'OTP sent successfully for password change' };
  }

  static async verifyPasswordChange(userId: bigint, newPassword: string, otpCode: string) {
    const { AuthService } = await import('@/services/auth.service');
    
    // Verify OTP
    await AuthService.verifyOtp(userId, otpCode, 'PASSWORD_RESET');

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash }
    });

    // Invalidate sessions
    await prisma.userSession.updateMany({
      where: { user_id: userId, status: 'ACTIVE' },
      data: { status: 'INACTIVE' }
    });

    return { success: true, message: 'Password changed successfully' };
  }

  /**
   * Create a new user with auto-generated password and email it to them
   */
  static async createUser(data: {
    firstName: string
    lastName: string
    email: string
    phone?: string
    roleId: bigint
    organizationId?: bigint
    branchId?: bigint
  }) {
    // 1. Check if email already exists
    const existingEmail = await prisma.user.findUnique({ where: { email: data.email } })
    if (existingEmail) {
      throw new Error('This email is already registered in the system.')
    }

    if (data.phone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone: data.phone } })
      if (existingPhone) {
        throw new Error('This phone number is already registered in the system.')
      }
    }

    // 2. Auto-generate secure password
    // Generates a random 8-character password e.g., 'A8b7$xF2'
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    for (let i = 0; i < 10; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }

    // 3. Hash password
    const bcrypt = await import('bcryptjs')
    const passwordHash = await bcrypt.hash(password, 10)

    // 4. Save User
    const user = await prisma.user.create({
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        phone: data.phone,
        role_id: data.roleId,
        organization_id: data.organizationId,
        branch_id: data.branchId,
        password_hash: passwordHash,
        status: 'ACTIVE'
      },
      include: {
        role: true,
        organization: true,
        Branch_User_branch_idToBranch: true
      }
    })
    user.branch = user.Branch_User_branch_idToBranch
    delete user.Branch_User_branch_idToBranch

    // 5. Send Email
    const { EmailService } = await import('@/services/email.service')
    const subject = 'Your Medicare One Account'
    const text = `Hello ${data.firstName}, your account has been created. Your login email is ${data.email} and your password is: ${password}`
    const html = `
      <h2>Welcome to Medicare One!</h2>
      <p>Hello <strong>${data.firstName} ${data.lastName}</strong>,</p>
      <p>An administrator has created an account for you.</p>
      <div style="background:#f4f4f4;padding:15px;margin:20px 0;border-radius:5px;">
        <p><strong>Login Email:</strong> ${data.email}</p>
        <p><strong>Temporary Password:</strong> <span style="font-family:monospace;font-size:16px;">${password}</span></p>
      </div>
      <p>Please log in and change your password immediately.</p>
    `
    // We don't await this so it doesn't block the API response
    EmailService.sendEmail(data.email, subject, html, text).catch(console.error)

    const { password_hash, ...safeUser } = user
    return safeUser
  }

}
