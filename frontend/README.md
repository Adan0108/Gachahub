Refactored the frontend :L Duma cang nao qua

Changed:
- Moved frontend from Vite to Next.js.
- Added TanStack Query for API fetching and loading/error states.
- Split the big App.jsx file into smaller pages and components.
- Changed community pages to use slugs like /community/wuthering-waves.
- Made Explore search read from the URL, like /explore?q=wuthering.
- Made community tabs read from the URL, like ?tab=Builds.
- Updated mock data 
- Moved backend API calls into frontend/lib/api.js.
- Added query setup in frontend/lib/queries.js.
- Removed old unused Vite files and unused prototype components.
- Updated env vars from VITE_* to NEXT_PUBLIC_*.
- Backend was not changed.

Validation:
- npm run lint passed.
- npm run build passed.