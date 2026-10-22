import { NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_SECONDS, createSessionToken, safeEqual } from '../../../lib/session.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const form = await request.formData();
  const username = String(form.get('username') || '');
  const password = String(form.get('password') || '');

  const adminUser = process.env.ADMIN_USERNAME || '';
  const adminPass = process.env.ADMIN_PASSWORD || '';

  // Compare both fields every time so the response time does not leak which one was wrong.
  const userOk = safeEqual(username, adminUser);
  const passOk = safeEqual(password, adminPass);
  const configured = adminUser.length > 0 && adminPass.length > 0;

  await new Promise((r) => setTimeout(r, 500)); // slows down password guessing

  if (!configured || !userOk || !passOk) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  }

  const res = NextResponse.redirect(new URL('/dashboard', request.url), 303);
  res.cookies.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
  return res;
}
