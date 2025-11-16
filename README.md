
# mailwolf

i get a lot of spam mail from not only people that used to live at my house, but from marketers that 
have gotten my address overtime.

this project is an effort to scan my email for USPS inbound spam utilizing "USPS Informed Delivery".

there is no customer facing API so i'm forced to take the unconventional approach of scraping my email for 
notifications.

after this, images will be scanned using OCR and the sender's details will be recorded.

then i will reference the sender's "opt-out" form / customer solutions email saved in my SQLite3 db.

using an LLM, the form will be filled and/or an email will be sent.

in the end all you have to do is mark the physical mail as "return to sender" and the idea is that
the company is aware that you want them to stop.

## Setup

1. Copy `.env.example` to `.env.local` and fill in your credentials:
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: From Google Cloud Console for OAuth
   - `GOOGLE_API_KEY`: Get from [Google AI Studio](https://aistudio.google.com/) for Gemini API
   - `NEXTAUTH_SECRET`: Generate a random secret for NextAuth
   - `NEXTAUTH_URL`: Your app URL (http://localhost:3000 for dev)

2. Install dependencies: `pnpm install`

3. Run database migrations: `pnpm drizzle:migrate`

4. Start the dev server: `pnpm dev`
