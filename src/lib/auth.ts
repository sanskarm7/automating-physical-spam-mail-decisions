import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { 
        params: { 
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent"
        } 
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email || !account?.providerAccountId) return false;
      const id = account.providerAccountId;
      const found = db.select().from(users).where(eq(users.id, id)).all();
      if (found.length === 0) {
        db.insert(users).values({ id, email: user.email, name: user.name ?? null }).run();
      }
      return true;
    },
    async jwt({ token, account, user }) {
      // Persist the OAuth access_token and providerAccountId to the token right after signin
      if (account) {
        token.access_token = account.access_token;
        token.providerAccountId = account.providerAccountId; // Store the actual user ID we use in DB
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.providerAccountId) {
        // Use providerAccountId (Google sub) which matches what we store in the DB
        (session as any).userId = token.providerAccountId as string;
        (session as any).access_token = token.access_token;
      }
      return session;
    }
  }
});

