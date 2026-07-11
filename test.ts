import { NextRequest } from 'next/server';
import { POST } from './src/app/api/auth/verify-otp/route';

async function run() {
  try {
    const req = new NextRequest('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ code: '123456' })
    });
    const res = await POST(req);
    console.log("STATUS:", res.status);
    console.log("BODY:", await res.text());
  } catch (e) {
    console.error("UNCAUGHT THREW:", e);
  }
}
run();
