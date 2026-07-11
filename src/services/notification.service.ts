import { prisma } from '@/lib/prisma'
import { EmailService } from './email.service'
import { smsSend } from './sms.service'
import { UserService } from './user.service'

export class NotificationService {
  /**
   * Get user notification preferences
   */
  static async getUserPreferences(userId: bigint) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        sms_notification_active: true,
        email_notification_active: true,
        auth_sms_active: true,
        auth_email_active: true,
        system_sms_active: true,
        system_email_active: true
      }
    })
    
    if (!user) throw new Error('User not found')
    
    return {
      // Legacy fields for backward compatibility
      smsEnabled: user.sms_notification_active,
      emailEnabled: user.email_notification_active,
      // New separate preferences
      authSmsEnabled: user.auth_sms_active,
      authEmailEnabled: user.auth_email_active,
      systemSmsEnabled: user.system_sms_active,
      systemEmailEnabled: user.system_email_active
    }
  }

  /**
   * Update user notification preferences
   */
  static async updatePreferences(userId: bigint, data: {
    smsEnabled?: boolean;
    emailEnabled?: boolean;
    authSmsEnabled?: boolean;
    authEmailEnabled?: boolean;
    systemSmsEnabled?: boolean;
    systemEmailEnabled?: boolean;
  }) {
    const safeUser = await UserService.updateNotificationPreferences(userId, {
      sms_notification_active: data.smsEnabled,
      email_notification_active: data.emailEnabled,
      auth_sms_active: data.authSmsEnabled,
      auth_email_active: data.authEmailEnabled,
      system_sms_active: data.systemSmsEnabled,
      system_email_active: data.systemEmailEnabled
    })
    
    return {
      smsEnabled: safeUser.sms_notification_active,
      emailEnabled: safeUser.email_notification_active,
      authSmsEnabled: safeUser.auth_sms_active,
      authEmailEnabled: safeUser.auth_email_active,
      systemSmsEnabled: safeUser.system_sms_active,
      systemEmailEnabled: safeUser.system_email_active
    }
  }

  /**
   * Send OTP with authentication preference checking
   */
  static async sendOtp(userId: bigint, email: string, phone: string | undefined, code: string, type: 'LOGIN_2FA' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', firstName?: string, lastName?: string) {
    const preferences = await this.getUserPreferences(userId)
    const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || 'User'

    if (preferences.authEmailEnabled) {
      if (type === 'EMAIL_VERIFICATION') {
        await EmailService.sendRegistrationOtp(email, code, fullName)
      } else if (type === 'PASSWORD_RESET') {
        await EmailService.sendPasswordResetOtp(email, code, fullName)
      } else {
        await EmailService.sendOtp(email, code, fullName)
      }
    }

    if (preferences.authSmsEnabled && phone) {
      const isLogin = type === 'LOGIN_2FA'
      const smsMessage = isLogin
        ? `Hello ${fullName}! Your Medicare System Login OTP is: ${code}. It expires in 30 minutes.`
        : `Hello ${fullName}! Your Medicare System OTP is: ${code}. It expires in 30 minutes.`
      smsSend({ phone, message: smsMessage }).catch(console.error)
    }

    return {
      emailSent: preferences.authEmailEnabled,
      smsSent: preferences.authSmsEnabled && !!phone
    }
  }

  /**
   * Send general system notification with system preference checking
   */
  static async sendNotification(userId: bigint, data: {
    emailSubject?: string;
    emailContent?: string;
    smsMessage?: string;
    smsSenderId?: string;
  }) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        system_sms_active: true,
        system_email_active: true
      }
    })

    if (!user) throw new Error('User not found')

    let emailSent = false
    let smsSent = false

    if (user.system_email_active && data.emailSubject && data.emailContent) {
      await EmailService.sendEmail(
        user.email,
        data.emailSubject,
        data.emailContent,
        data.emailContent.replace(/<[^>]*>/g, '')
      ).catch(console.error)
      emailSent = true
    }

    if (user.system_sms_active && user.phone && data.smsMessage) {
      await smsSend({
        phone: user.phone,
        message: data.smsMessage,
        senderId: data.smsSenderId
      }).catch(console.error)
      smsSent = true
    }

    return { emailSent, smsSent }
  }
}
