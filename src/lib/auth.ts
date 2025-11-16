import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { google } from "googleapis";

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

    async jwt({ token, account, user }) {
      // Initial sign in - save tokens
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.expires_at = account.expires_at ? account.expires_at * 1000 : null; // Convert to milliseconds
        token.providerAccountId = account.providerAccountId;
        return token;
      }

      // Token refresh - check if access token is expired or will expire soon
      const expiresAt = token.expires_at as number | undefined;
      const now = Date.now();
      
      // If token expires in less than 5 minutes, refresh it
      if (expiresAt && expiresAt < now + 5 * 60 * 1000) {
        if (token.refresh_token) {
          try {
            const oauth2Client = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET
            );
            
            oauth2Client.setCredentials({
              refresh_token: token.refresh_token as string,
            });

            const { credentials } = await oauth2Client.refreshAccessToken();
            
            token.access_token = credentials.access_token;
            token.expires_at = credentials.expiry_date ? credentials.expiry_date : null;
            
            // Update refresh token if a new one is provided
            if (credentials.refresh_token) {
              token.refresh_token = credentials.refresh_token;
            }
          } catch (error) {
            console.error("Error refreshing access token:", error);
            // Token refresh failed - user will need to sign in again
            token.access_token = null;
            token.expires_at = null;
          }
        } else {
          // No refresh token available - user needs to sign in again
          token.access_token = null;
          token.expires_at = null;
        }
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
