# JobMagnet starter

Empty install. Profile, resume, Gmail, jobs, and story cards are not included. The working copy in `projects/jobmagnet` is a different folder and a different app data directory.

This build uses `~/Library/Application Support/jobmagnet-starter` and control port `3872`.

## Run

```
cd projects/jobmagnet-starter
npm install
npm run build:ui
npm start
```

Ingest opens first and walks through a Cursor API key, Gmail, a resume, and a first batch of story cards.

Insights is the analytics window. It stays empty until there are applications to count.
