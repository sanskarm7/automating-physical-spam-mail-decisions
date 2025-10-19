
# MailOps MVP (Next.js 14 + SQLite + Drizzle)

## Setup
1. `pnpm i`
2. Copy `.env.example` to `.env.local` and fill Google credentials and NEXTAUTH_SECRET.
3. Create `data/` folder: `mkdir -p data`
4. Run migrations:
   ```bash
   pnpm drizzle:generate
   pnpm drizzle:migrate
   ```
5. `pnpm dev` and open http://localhost:3000

## Notes
- The ingest endpoint reads USPS Informed Delivery digests using the Gmail API and stores parsed tiles.
- Parsing is heuristic. Improve `src/lib/parser.ts` as you collect real samples.
- Add the Sender Directory, action routing, and opt-out automation next.
