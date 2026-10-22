import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySessionToken } from './session.js';

export async function isAdmin() {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}
