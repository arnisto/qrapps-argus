'use client';

import { signout } from '@/lib/auth-client';

export function SignoutButton() {
  async function onClick() {
    await signout();
    window.location.href = '/signin';
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-fg-2 hover:text-fg-0 transition text-sm underline-offset-4 hover:underline"
    >
      Sign out
    </button>
  );
}
