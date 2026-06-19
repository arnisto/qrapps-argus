import Link from 'next/link';
import { SignoutButton } from './SignoutButton';

interface Props {
  userLabel: string;
}

/**
 * Top bar for every authed page. Brand on the left, user identity + sign
 * out on the right. Sticky so deep scrolling never strands the user
 * without their nav.
 */
export function AppHeader({ userLabel }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg-0/85 backdrop-blur px-4 sm:px-6 py-3 flex items-center justify-between">
      <Link href="/environments" className="flex items-center gap-2 text-fg-0">
        <span aria-hidden className="text-[18px]">🛰️</span>
        <span className="font-semibold tracking-tight">Argus</span>
      </Link>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-fg-2 truncate max-w-[200px]" title={userLabel}>
          {userLabel}
        </span>
        <SignoutButton />
      </div>
    </header>
  );
}
