
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const handler = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: { scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly" } }
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
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session as any).userId = token.sub;
      }
      return session;
    }
  }
});

export { handler as GET, handler as POST };
