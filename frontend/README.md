# GachaHub Frontend

Next.js frontend for GachaHub.

## Stack

- Next.js App Router
- React
- TanStack Query
- Shared backend API contract in `lib/api.js`

## Local setup

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

The backend usually runs on:

```text
http://localhost:3000
```

If the backend uses port `3000`, start the frontend on port `5173`:

```powershell
npm.cmd run dev -- -p 5173
```

## Environment

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_USE_MOCKS=false
```

Set `NEXT_PUBLIC_USE_MOCKS=true` to develop the UI without a running backend.
