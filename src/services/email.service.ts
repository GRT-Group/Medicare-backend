export class EmailService {
  /**
   * Internal Template Engine to wrap all emails in a beautiful, branded design.
   */
  private static getBaseEmailTemplate(title: string, content: string) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f0f7f7;
      margin: 0;
      padding: 0;
      color: #333333;
    }
    .email-container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
    }
    .header {
      background-color: #14A39A;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .content {
      padding: 40px 30px;
      line-height: 1.6;
      font-size: 16px;
    }
    .footer {
      background-color: #f8fafc;
      padding: 25px 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 13px;
      color: #64748b;
    }
    .footer p {
      margin: 5px 0;
    }
    .footer a {
      color: #14A39A;
      text-decoration: none;
    }
    .otp-box {
      background-color: #f0fdfa;
      border: 2px dashed #14A39A;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin: 30px 0;
    }
    .otp-code {
      font-family: monospace;
      font-size: 32px;
      font-weight: 700;
      color: #14A39A;
      letter-spacing: 4px;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>MediCare ONE</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>Need help? Contact our support team:</p>
      <p>
        <a href="mailto:support@[YOUR_DOMAIN].com">support@[YOUR_DOMAIN].com</a> | 
        <a href="tel:+[YOUR_PHONE]">+1 (800) 123-4567</a>
      </p>
      <p>&copy; ${new Date().getFullYear()} MediCare ONE. All rights reserved.</p>
      <p><small>https://[YOUR_DOMAIN].com</small></p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Send an email using Resend API via fetch. `attachments`, if given, are
   * passed straight through in Resend's own shape (base64 `content` +
   * `filename`) — e.g. for attaching a generated invoice PDF.
   */
  static async sendEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
    attachments?: { filename: string; content: string }[]
  ) {
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'MEDICARE ONE <info@futureinnovatech.rw>'

    if (!RESEND_API_KEY) {
      console.error('[RESEND CONFIG ERROR] RESEND_API_KEY is not set — email not sent.')
      return false
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to,
          subject,
          html,
          text,
          ...(attachments && attachments.length > 0 ? { attachments } : {})
        })
      })

      const data = await response.json()
      
      if (response.ok) {
        console.log(`[RESEND SUCCESS] Email sent to ${to}: ${data.id}`)
        return true
      } else {
        console.error(`[RESEND ERROR] Failed to send email to ${to}:`, data)
        return false
      }
    } catch (error) {
      console.error('[RESEND EXCEPTION] Error sending email:', error)
      return false
    }
  }

  /**
   * Send an OTP to the specified email address (For Login/Verification)
   */
  static async sendOtp(to: string, otp: string, fullName: string = 'User') {
    const subject = '🔐 Your Verification Code'
    const text = `Hello ${fullName}! Your OTP code is: ${otp}`
    const content = `
      <h2>🛡️ Verify your login</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>You recently attempted to sign in to your MediCare ONE account. Please use the secure verification code below to complete the process:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p>If you did not request this code, please ignore this email or contact support immediately.</p>
    `
    const html = this.getBaseEmailTemplate(subject, content)
    
    return this.sendEmail(to, subject, html, text)
  }

  /**
   * Send an OTP for Account Registration Verification
   */
  static async sendRegistrationOtp(to: string, otp: string, fullName: string = 'User') {
    const subject = '✉️ Verify your Account Registration'
    const text = `Hello ${fullName}! Your registration verification code is: ${otp}`
    const content = `
      <h2>✅ Account Verification Required</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>Thank you for registering your organization with <strong>MediCare ONE</strong>! 🎉 Before you can log in, we need to verify your email address. Please use the 6-digit verification code below:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>⏳ This code will expire in 30 minutes.</strong></p>
      <p>Once verified, your account will be fully activated and you can start managing your healthcare operations.</p>
    `
    const html = this.getBaseEmailTemplate(subject, content)
    
    return this.sendEmail(to, subject, html, text)
  }

  /**
   * Send Verification Success Email
   */
  static async sendVerificationSuccessEmail(to: string, firstName: string) {
    const subject = '✅ Account Verified Successfully'
    const text = `Hello ${firstName}, your email has been successfully verified.`
    const content = `
      <h2>🎉 You're all set!</h2>
      <p>Hello <strong>${firstName}</strong>,</p>
      <p>Your email address has been successfully verified. Your account is now fully active and secure.</p>
      <p>You can now log in to the MediCare ONE portal and start managing your healthcare operations.</p>
      <br>
      <p><em>Welcome to the MediCare ONE family!</em></p>
    `
    const html = this.getBaseEmailTemplate(subject, content)
    
    return this.sendEmail(to, subject, html, text)
  }

  static async sendWelcomeEmail(to: string, organizationName: string, subscriptionLink?: string) {
    const subject = '🎉 Welcome to MediCare ONE'
    const text = `Hello, your organization ${organizationName} has been successfully registered. Please set up your subscription to fully activate your account.`
    const linkHtml = subscriptionLink 
      ? `<p><a href="${subscriptionLink}" style="display: inline-block; padding: 12px 24px; background-color: #14A39A; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 15px 0;">Complete Subscription</a></p>`
      : ''
    
    const content = `
      <h2>🚀 Welcome aboard!</h2>
      <p>We are absolutely thrilled to let you know that your organization <strong>${organizationName}</strong> has been successfully registered on our enterprise platform.</p>
      <p>To start using our services, please log in and choose a subscription plan. You can do this at any time that is convenient for you.</p>
      ${linkHtml}
      <p>Once your subscription is active, you can begin managing your healthcare operations without any operational gaps. 💼</p>
      <br>
      <p><em>Thank you for choosing MediCare ONE.</em></p>
    `
    const html = this.getBaseEmailTemplate(subject, content)
    
    return this.sendEmail(to, subject, html, text)
  }

  /**
   * Send Password Reset OTP
   */
  static async sendPasswordResetOtp(to: string, otp: string, fullName: string = 'User') {
    const subject = 'Password Reset Request'
    const text = `Hello ${fullName}! Your password reset code is: ${otp}`
    const content = `
      <h2>Reset your password</h2>
      <p>Hello <strong>${fullName}</strong>,</p>
      <p>We received a request to reset the password for your MediCare ONE account. Please use the secure code below to proceed:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>This code will expire in 30 minutes.</strong></p>
      <p>If you did not request a password reset, please ignore this email. Your account remains completely secure.</p>
    `
    const html = this.getBaseEmailTemplate(subject, content)

    return this.sendEmail(to, subject, html, text)
  }

  /**
   * Send a purchase order invoice to a supplier's email when a new PO is
   * raised against them, so they have the order details/expected items
   * without needing portal access. Renders as an invoice document (PO
   * number, line items, total) rather than a plain notification, since this
   * doubles as the supplier's copy of the order.
   */
  static async sendPurchaseOrderEmail(
    to: string,
    supplierName: string,
    organizationName: string,
    po: {
      id: string | number
      poNumber?: string
      totalAmount: string | number
      expectedDeliveryDate?: Date | null
      items: { productName: string; quantity: number; unitCost: string | number }[]
    },
    invoicePdf?: { filename: string; content: string }
  ) {
    const poNumber = po.poNumber || `PO-${po.id}`
    const subject = `📦 Purchase Order Invoice ${poNumber} from ${organizationName}`
    const text = `Hello ${supplierName}, ${organizationName} has raised Purchase Order ${poNumber} with you for a total of ${po.totalAmount}. Please review the item list below and confirm delivery.`

    const rows = po.items.map(item => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${item.productName}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${item.unitCost}</td>
      </tr>
    `).join('')

    const deliveryLine = po.expectedDeliveryDate
      ? `<p>Expected delivery date: <strong>${po.expectedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>`
      : ''

    const content = `
      <h2>📦 Purchase Order Invoice</h2>
      <table style="width:100%;margin-bottom:20px;">
        <tr><td style="color:#64748b;">Invoice / PO Number</td><td style="text-align:right;"><strong>${poNumber}</strong></td></tr>
        <tr><td style="color:#64748b;">Date</td><td style="text-align:right;">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
        <tr><td style="color:#64748b;">Billed To</td><td style="text-align:right;">${supplierName}</td></tr>
        <tr><td style="color:#64748b;">Issued By</td><td style="text-align:right;">${organizationName}</td></tr>
      </table>
      <p>Hello <strong>${supplierName}</strong>,</p>
      <p><strong>${organizationName}</strong> has raised the purchase order below with you.</p>
      ${deliveryLine}
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="background-color:#f0fdfa;">
            <th style="padding:8px;text-align:left;">Product</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Unit Cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:18px;"><strong>Total: ${po.totalAmount}</strong></p>
      <p>Please prepare the order and contact us if any item is unavailable or the delivery date needs adjusting.</p>
    `
    const html = this.getBaseEmailTemplate(subject, content)

    return this.sendEmail(to, subject, html, text, invoicePdf ? [invoicePdf] : undefined)
  }

  /**
   * Send a subscription renewal reminder to an organization's contact email.
   * Covers both "expiring soon" and "already expired" phrasing from one template.
   */
  static async sendSubscriptionReminder(
    to: string,
    organizationName: string,
    planName: string,
    endDate: Date,
    daysUntilExpiry: number,
    renewalLink?: string
  ) {
    const isExpired = daysUntilExpiry < 0
    const subject = isExpired
      ? `⚠️ Your ${planName} subscription has expired`
      : `⏰ Your ${planName} subscription expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`

    const formattedDate = endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    const statusLine = isExpired
      ? `Your subscription expired on <strong>${formattedDate}</strong>. Access to core features may be restricted until you renew.`
      : `Your subscription is set to expire on <strong>${formattedDate}</strong> (in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}).`

    const text = `Hello ${organizationName}, ${isExpired ? 'your' : 'your'} ${planName} subscription ${isExpired ? 'expired' : 'expires'} on ${formattedDate}. Please renew to avoid any service interruption.`

    const linkHtml = renewalLink
      ? `<p><a href="${renewalLink}" style="display: inline-block; padding: 12px 24px; background-color: #14A39A; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 15px 0;">Renew Subscription</a></p>`
      : ''

    const content = `
      <h2>${isExpired ? '⚠️ Subscription Expired' : '⏰ Renewal Reminder'}</h2>
      <p>Hello <strong>${organizationName}</strong>,</p>
      <p>${statusLine}</p>
      <p>Current plan: <strong>${planName}</strong></p>
      ${linkHtml}
      <p>If you have already renewed, please disregard this message.</p>
    `
    const html = this.getBaseEmailTemplate(subject, content)

    return this.sendEmail(to, subject, html, text)
  }
}
