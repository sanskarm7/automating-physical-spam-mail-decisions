import { SessionProvider } from "next-auth/react"

export const metadata = {
  title: 'MailWolf MVP',
  description: 'Automate physical spam mail decisions',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}