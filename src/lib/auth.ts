import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

async function ensureUserInDb(params: { id: string; email: string; name: string | null }) {
  const { id, email, name } = params;

  const existingUsers = db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .all();

  if (existingUsers.length === 0) {
    db.insert(users)
      .values({ id, email, name })
      .run();
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account?.providerAccountId) {
        return false;
      }

      await ensureUserInDb({
        id: account.providerAccountId,
        email: user.email,
        name: user.name ?? null,
      });

      return true;
    },

    async jwt({ token, account }) {
      // Persist the OAuth access_token and providerAccountId to the token right after signin
      if (account) {
        token.access_token = account.access_token;
        token.providerAccountId = account.providerAccountId;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.providerAccountId) {
        (session as any).userId = token.providerAccountId as string;
        (session as any).access_token = token.access_token;
      }
      return session;
    },
  },
});
