function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

let data = { standard: [], groups: [] };
let backendBaseUrl = null;
let isConnected = false;

function patchTasks(tasks) {
    tasks.forEach(task => {
        if (!task.id) {
            task.id = generateId();
        }
        if (!Array.isArray(task.subtasks)) {
            task.subtasks = [];
        }
        if (task.subtasks.length > 0 && task.isExpanded === undefined) {
            task.isExpanded = true;
        }
        if (task.subtasks.length > 0) {
            patchTasks(task.subtasks);
        }
    });
}

function ensureStandardCategories() {
    if (!Array.isArray(data.standard)) {
        data.standard = [];
        return;
    }

    const isLegacyStructure = data.standard.some(item => item && !('tasks' in item) && 'text' in item);
    if (isLegacyStructure) {
        const legacyTasks = data.standard.filter(item => item && 'text' in item);
        data.standard = [{
            id: generateId(),
            name: 'General',
            tasks: legacyTasks
        }];
    }

    data.standard.forEach(category => {
        if (!category.id) {
            category.id = generateId();
        }
        if (!category.name) {
            category.name = 'Category';
        }
        if (!Array.isArray(category.tasks)) {
            category.tasks = [];
        }
        patchTasks(category.tasks);
    });
}

function normaliseData() {
    ensureStandardCategories();
    if (!Array.isArray(data.groups)) {
        data.groups = [];
    }
    data.groups.forEach(group => {
        if (group.duration && group.duration.value !== undefined) {
            if (group.duration.unit === 'd') {
                group.duration = { days: group.duration.value, hours: 0, minutes: 0 };
            } else if (group.duration.unit === 'h') {
                group.duration = { days: 0, hours: group.duration.value, minutes: 0 };
            }
        }
        if (!Array.isArray(group.tasks)) {
            group.tasks = [];
        }
        patchTasks(group.tasks);
    });
}

function saveLocalData() {
    localStorage.setItem('todo-data', JSON.stringify(data));
}

function cleanBaseUrl(url) {
    return url.replace(/\/+$/, '');
}

async function loadData() {
    const storedBackend = localStorage.getItem('backend-url');
    if (storedBackend) {
        const baseUrl = cleanBaseUrl(storedBackend);
        try {
            const response = await fetch(`${baseUrl}/data`);
            if (!response.ok) {
                throw new Error(`Backend responded with status ${response.status}`);
            }
            data = await response.json();
            backendBaseUrl = baseUrl;
            isConnected = true;
            normaliseData();
            saveLocalData();
            return;
        } catch (error) {
            console.warn('Falling back to local data. Unable to reach backend.', error);
            backendBaseUrl = baseUrl;
            isConnected = false;
        }
    }

    const saved = localStorage.getItem('todo-data');
    if (saved) {
        try {
            data = JSON.parse(saved);
        } catch (error) {
            console.error('Failed to parse local data, starting with an empty dataset.', error);
            data = { standard: [], groups: [] };
        }
    } else {
        data = { standard: [], groups: [] };
    }
    normaliseData();
    saveLocalData();
}

async function syncWithBackend() {
    if (!isConnected || !backendBaseUrl) {
        return true;
    }
    try {
        const response = await fetch(`${backendBaseUrl}/data`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error(`Sync failed with status ${response.status}`);
        }
        return true;
    } catch (error) {
        console.error('Failed to sync data with backend', error);
        return false;
    }
}

async function persistData() {
    saveLocalData();
    const synced = await syncWithBackend();
    if (!synced) {
        isConnected = false;
    }
    return synced;
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

window.addEventListener('DOMContentLoaded', async () => {
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

    await loadData();
    const parentTask = findTaskById(data, taskId);

    if (!parentTask) {
        alert('Task not found!');
        window.location.href = 'index.html';
        return;
    }

    header.textContent = `Add Subtask to Task "${parentTask.text}"`;
    if (!Array.isArray(parentTask.subtasks)) parentTask.subtasks = [];

    renderSubtasks(parentTask, subtaskList);

    addSubtaskBtn.addEventListener('click', async () => {
        const text = newSubtaskText.value.trim();
        if (text) {
            parentTask.subtasks.push({ id: generateId(), text: text, done: false, subtasks: [] });
            parentTask.isExpanded = true;
            newSubtaskText.value = '';
            const synced = await persistData();
            renderSubtasks(parentTask, subtaskList);
            if (!synced && backendBaseUrl) {
                alert('Unable to sync with the backend. The change was stored locally.');
            }
        }
    });
});
