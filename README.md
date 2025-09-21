# toDo_Groups

Simple in-browser To-Do application that supports single tasks and task groups with repeating periods.

## Usage

Open `index.html` in any modern web browser. Tasks and groups are stored in `localStorage` so they persist across reloads.

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
