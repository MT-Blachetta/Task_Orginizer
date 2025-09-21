function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Recursive function to find a task by its ID in a list of tasks
function findTask(taskId, tasks) {
    for (const task of tasks) {
        if (task.id === taskId) return task;
        if (task.subtasks) {
            const found = findTask(taskId, task.subtasks);
            if (found) return found;
        }
    }
    return null;
}

// Finds a task by its ID across all data
function findTaskById(data, taskId) {
    if (Array.isArray(data.standard)) {
        const looksLikeCategories = data.standard.some(item => item && item.tasks !== undefined);
        if (looksLikeCategories) {
            for (const category of data.standard) {
                const found = findTask(taskId, Array.isArray(category.tasks) ? category.tasks : []);
                if (found) return found;
            }
        } else {
            const found = findTask(taskId, data.standard);
            if (found) return found;
        }
    }
    for (const group of data.groups) {
        const found = findTask(taskId, group.tasks);
        if (found) return found;
    }
    return null;
}

function renderSubtasks(parentTask, container) {
    container.innerHTML = '';
    if (!parentTask.subtasks) {
        parentTask.subtasks = [];
    }
    parentTask.subtasks.forEach(subtask => {
        const li = document.createElement('li');
        li.className = 'task-item';
        const span = document.createElement('span');
        span.textContent = subtask.text;
        span.className = 'task-text';
        span.addEventListener('click', () => {
            // Navigate to edit this subtask's own subtasks
            window.location.href = `subtask.html?taskId=${subtask.id}`;
        });
        li.appendChild(span);
        container.appendChild(li);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('subtask-header');
    const newSubtaskText = document.getElementById('new-subtask-text');
    const addSubtaskBtn = document.getElementById('add-subtask-btn');
    const subtaskList = document.getElementById('subtask-list');

    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('taskId');

    if (!taskId) {
        alert('No task ID provided.');
        window.location.href = 'index.html';
        return;
    }

    let data = JSON.parse(localStorage.getItem('todo-data')) || { standard: [], groups: [] };
    const parentTask = findTaskById(data, taskId);

    if (!parentTask) {
        alert('Task not found!');
        window.location.href = 'index.html';
        return;
    }

    header.textContent = `Add Subtask to Task "${parentTask.text}"`;
    if (!parentTask.subtasks) parentTask.subtasks = [];

    renderSubtasks(parentTask, subtaskList);

    addSubtaskBtn.addEventListener('click', () => {
        const text = newSubtaskText.value.trim();
        if (text) {
            parentTask.subtasks.push({ id: generateId(), text: text, done: false, subtasks: [] });
            newSubtaskText.value = '';
            localStorage.setItem('todo-data', JSON.stringify(data));
            renderSubtasks(parentTask, subtaskList);
        }
    });
});