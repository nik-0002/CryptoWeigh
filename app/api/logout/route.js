import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../lib/session.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const res = NextResponse.redirect(new URL('/login', request.url), 303);
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
