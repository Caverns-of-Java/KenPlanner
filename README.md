# EthanPlannerv2 MVP

EthanPlannerv2 is a lightweight planner with:
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
4. Run the `initializeSheets` function once from Apps Script editor.
5. Deploy as Web App:
   - Execute as: Me
   - Who has access: Anyone
6. Copy the deployment URL.
7. Open `docs/index.html` in a browser (or host `docs/` on GitHub Pages via Settings → Pages → /docs folder).

## Endpoint Contract

Use query parameter `endpoint` on the Apps Script URL.

GET:
- `?endpoint=ping`
- `?endpoint=week&start=YYYY-MM-DD`
- `?endpoint=year&year=YYYY`

POST (`Content-Type: text/plain;charset=utf-8`, JSON body):
- `?endpoint=task-add` body: `{ date, description }`
- `?endpoint=task-update` body: `{ id, completed?, description?, status? }`
- `?endpoint=task-delete` body: `{ id }`
- `?endpoint=journal-update` body: `{ date, entry, expectedVersion? }`

All responses:
- Success: `{ success: true, data: ... }`
- Error: `{ success: false, error, message }`

## Notes

- Task identity is UUID based (not sheet row based).
- Task delete is soft delete (`status = DELETED`).
- Journal updates increment `version` for stale-write detection.
- Year data is cached client-side for 5 minutes, with manual refresh button.
- Passcode in the frontend is a local UI lock only and is not sent to the API.
