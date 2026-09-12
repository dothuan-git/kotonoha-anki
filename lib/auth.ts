import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const allowedEmail = process.env.ALLOWED_EMAIL?.trim().toLowerCase();

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  // No adapter and no user tables: one person, no registration.
  session: { strategy: 'jwt' },
  // error must be set too: a signIn-callback rejection routes to pages.error,
  // which otherwise falls back to Auth.js's own page and loses our message.
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    signIn({ profile }) {
      // Refuse anyone but the allowlisted address. A missing
      // ALLOWED_EMAIL refuses everyone rather than admitting everyone.
      if (!allowedEmail) return false;
      const email = profile?.email?.trim().toLowerCase();
      return email === allowedEmail && profile?.email_verified !== false;
    },
  },
});

/**
 * The real gate. `proxy.ts` only redirects browsers; every server action and
 * route handler calls this, because a proxy that is misconfigured or bypassed
 * must not leave the data open.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error('Unauthorized');
  }
  return session;
}
