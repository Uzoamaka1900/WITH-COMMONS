# WITH Archive Backend

Tailored backend scaffold for the **WITH Archive – Women in Technology** frontend.

This backend is customized to support the exact experience visible in the uploaded `WITH.HTML`:
- email + magic-link + Google + Microsoft sign-in
- top-level sections for **About**, **Discover**, **Collections**, **Stories**, **Contribute**, and **Analytics**
- search with **query + format + decade** filters
- featured hero gallery and collection slideshow
- collection cards with item counts and tags
- contribution intake for photographs, oral histories, documents, and publications
- admin-friendly analytics for visits, searches, collection opens, and contribution starts
- activity feed events that replace the demo `localStorage` logic with a persistent API-backed model

The frontend currently uses localStorage-based demo state for `withArchiveSession`, `withArchiveAnalytics`, `withArchiveCollections`, and `withArchiveActivity`; this backend is designed to replace those with persistent database-backed endpoints.

## Project shape

```text
server/
  src/
    modules/
      auth/           # sign in, magic link, oauth callbacks
      users/          # members, contributors, admins
      items/          # archive items shown in search and collections
      collections/    # collection pages + featured/hero content
      stories/        # narrative entry points
      contributions/  # intake workflow for community submissions
      media/          # files, thumbnails, transcripts, derivatives
      metadata/       # controlled vocabularies and metadata helpers
      search/         # search + filters for query/format/decade
      analytics/      # counters and event ingestion
      reviews/        # approval workflow for submissions
```

## Core frontend mappings

| Frontend feature | Backend module | Example endpoint |
|---|---|---|
| Login form / social buttons / magic link | auth | `/api/auth/login`, `/api/auth/magic-link`, `/api/auth/oauth/google` |
| Search input + format/decade filters | search | `/api/search?q=&format=&decade=` |
| Hero gallery / collection slideshow | collections | `/api/collections/featured` |
| Collection grid | collections | `/api/collections` |
| Story cards | stories | `/api/stories` |
| Contribution form | contributions | `/api/contributions` |
| Stats and bars | analytics | `/api/analytics/summary` |
| Live activity feed | analytics | `/api/analytics/activity` |

## Run locally

```bash
cd server
npm install
npm run dev
```

## Database

See:
- `database/schemas/001_init.sql`
- `database/seeders/001_seed.sql`
- `database/schemas/archive-item.schema.json`
- `database/schemas/collection.schema.json`
- `database/schemas/contribution.schema.json`
- `database/schemas/frontend-api-map.json`

## Notes specific to the uploaded frontend

- The frontend currently references `./asserts/logo.png`; you may want to rename that folder to `assets` in production.
- The current demo uses in-browser analytics increments. This backend introduces a proper `analytics_events` table and summary endpoint.
- The current demo collections are hard-coded: **Anecdotes and Oral Histories**, **Anniversary Images**, and **WITH 50th Anniversary**. Seed data includes these exact collections.
