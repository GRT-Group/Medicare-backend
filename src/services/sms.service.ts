/**
 * HDEV SMS API Configuration
 */

const getApiId = () => process.env.HDEV_API_ID || 'HDEV-db91b7c9-d57f-40cd-9fc9-c5df3988e8b7-ID'
const getApiKey = () => process.env.HDEV_API_KEY || 'HDEV-c220ece8-f658-4456-bbfa-8693c8ce6162-KEY'
const getBaseUrl = () => process.env.HDEV_SMS_URL || 'https://sms-api.hdev.rw/v1/api'

async function request(payload: any) {
  const url = `${getBaseUrl()}/${getApiId()}/${getApiKey()}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
    });
    
    const textRes = await res.text();
    try {
      return JSON.parse(textRes);
    } catch (e) {
      console.error("[SMS RESPONSE NOT JSON]:", textRes);
      return { success: false, message: textRes };
    }
  } catch (error) {
    console.error("[SMS REQUEST ERROR]", error)
    return null
  }
}

/**
 * Send SMS (Internal Core Function)
 */
export async function sendSMS(sender_id: string, tel: string, message: string, link: string = "") {
  return request({
    ref: "sms",
    sender_id,
    tel,
    message,
    link,
  });
}

/**
 * Top up SMS balance
 */
export async function topupSMS(tel: string, amount: string | number, transaction_ref: string = "", link: string = "") {
  const tx_ref = transaction_ref || `HDEVSMS-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
  return request({
    ref: "pay",
    tel,
    tx_ref,
    amount,
    link,
  });
}

/**
 * Check topup status
 */
export async function getTopup(tx_ref: string) {
  return request({
    ref: "read",
    tx_ref,
  });
}

/**
 * Generic SMS sender (use everywhere)
 */
export async function smsSend({
  phone,
  message,
  senderId = "N-SMS",
}: {
  phone: string;
  message: string;
  senderId?: string;
}) {
  try {
    const response = await sendSMS(senderId, phone, message);

    if (!response || response.status !== 'success') {
      console.error("[SMS API FAILED]", response);
      return {
        success: false,
        message: "SMS failed to send via provider",
      };
    }

    console.log(`[SMS SUCCESS] Sent to ${phone}`)
    return {
      success: true,
      data: response,
    };
  } catch (err) {
    console.error("[SMS CATCH ERROR]:", err);
    return {
      success: false,
      message: "Server error sending SMS",
    };
  }
}
