# toDo_Groups

Task management application for personal use. The frontend works in any modern browser and can connect to a lightweight Python backend that stores tasks in a persistent SQLite database.

## Backend API

Run the backend before connecting from the web app:

```bash
python backend/app.py
```

The server listens on port `3001` by default (override with the `PORT` environment variable). All data is stored in `backend/database.sqlite`.

## Usage

1. Open `index.html` in your browser.
2. Click **Connect** and enter the backend host/IP and port (for example `localhost` and `3001`).
3. After connecting, tasks and groups are stored on the backend. If the connection fails, changes are stored locally and you can retry later.

Without a backend the app still works using `localStorage`, but data will remain on the current device only.

### Standard Tasks
- Add a text in the input field and click **Add Task**.
- Checking a standard task removes it from the list.

### Groups
- Provide a group name, a start time and a duration in days, hours and minutes and click **Add Group**.
- If the duration is exactly `1` day the header shows `daily`.
- Double click a task to edit it or press the **x** button to remove it.
- When all tasks in a group are checked the group turns light green. Otherwise it is light yellow.
- Checked tasks are automatically reset at the next period start time.

To run a quick development server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.
