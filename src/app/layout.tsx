import { Providers } from "./providers";

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
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}