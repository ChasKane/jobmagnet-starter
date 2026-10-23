export const CONTOSO_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sample Apply — Contoso</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 1.25rem; background: #0f172a; color: #e2e8f0; }
      label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; }
      input, textarea { width: 100%; padding: 0.6rem; font: inherit; background: #1e293b; color: inherit; border: 1px solid #334155; border-radius: 6px; box-sizing: border-box; }
      button { margin-top: 1rem; padding: 0.7rem 1rem; font: inherit; border-radius: 6px; border: 0; background: #38bdf8; color: #0f172a; font-weight: 650; }
    </style>
  </head>
  <body>
    <h1>Contoso — Application</h1>
    <form id="apply" onsubmit="event.preventDefault(); status.textContent='Saved locally (demo).';">
      <label for="fullName">Full name</label>
      <input id="fullName" name="fullName" />
      <label for="portfolio">Portfolio URL</label>
      <input id="portfolio" name="portfolio" type="url" />
      <label for="pitch">Why do you want this role? Please tell us in your own words.</label>
      <textarea id="pitch" name="pitch" rows="6"></textarea>
      <label for="resume">Resume</label>
      <input id="resume" name="resume" type="file" />
      <button type="submit">Continue</button>
      <p id="status"></p>
    </form>
  </body>
</html>`;
