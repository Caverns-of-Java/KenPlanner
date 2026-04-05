# KenPlanner MVP

KenPlanner is a lightweight planner with:
- Weekly view (Monday to Sunday) for tasks and journal
- Yearly overview with month grids
- Google Apps Script API + Google Sheets storage
- Static frontend suitable for GitHub Pages

## Project Structure

- `appscript/Code.gs`: backend API + sheet initialization
- `docs/index.html`: app shell
- `docs/styles.css`: UI styles
- `docs/app.js`: weekly/yearly logic and API calls

## Google Sheets Schema

Tasks sheet columns:
1. id
2. date
3. description
4. completed
5. created_at
6. updated_at
7. status

Journal sheet columns:
1. date
2. entry
3. updated_at
4. version

## Setup Steps

1. Create a new Google Sheet.
2. Open Extensions -> Apps Script.
3. Replace the default script with `appscript/Code.gs`.
4. In Apps Script, set script property:
   - Key: `SHARED_SECRET`
   - Value: your secret string
5. Run the `initializeSheets` function once from Apps Script editor.
6. Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone
7. Copy the deployment URL.
8. Open `docs/index.html` in a browser (or host `docs/` on GitHub Pages via Settings → Pages → /docs folder).
9. In app header:
   - Set Apps Script URL
   - Set shared secret
   - Click Save

## Endpoint Contract

Use query parameter `endpoint` on the Apps Script URL.

GET:
- `?endpoint=ping`
- `?endpoint=week&start=YYYY-MM-DD`
- `?endpoint=year&year=YYYY`

POST (`Content-Type: text/plain;charset=utf-8`, JSON body):
- `?endpoint=task-add` body: `{ date, description, secret }`
- `?endpoint=task-update` body: `{ id, completed?, description?, status?, secret }`
- `?endpoint=task-delete` body: `{ id, secret }`
- `?endpoint=journal-update` body: `{ date, entry, expectedVersion?, secret }`

All responses:
- Success: `{ success: true, data: ... }`
- Error: `{ success: false, error, message }`

## Notes

- Task identity is UUID based (not sheet row based).
- Task delete is soft delete (`status = DELETED`).
- Journal updates increment `version` for stale-write detection.
- Year data is cached client-side for 5 minutes, with manual refresh button.
