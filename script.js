const categoryGrid = document.getElementById('category-grid');
const addCategoryBtn = document.getElementById('add-category-btn');
const newCategoryNameInput = document.getElementById('new-category-name');

const groupNameInput = document.getElementById('group-name');
const groupStartInput = document.getElementById('group-start');
const groupDurationDaysInput = document.getElementById('group-duration-days');
const groupDurationHoursInput = document.getElementById('group-duration-hours');
const groupDurationMinutesInput = document.getElementById('group-duration-minutes');
const addGroupBtn = document.getElementById('add-group-btn');
const groupsDiv = document.getElementById('groups');
const clearDataBtn = document.getElementById('clear-data-btn'); // New: Clear Data Button
const connectBtn = document.getElementById('connect-btn');
const connectionModal = document.getElementById('connection-modal');
const connectionForm = document.getElementById('connection-form');
const connectionHostInput = document.getElementById('connection-host');
const connectionPortInput = document.getElementById('connection-port');
const connectionCancelBtn = document.getElementById('connection-cancel-btn');
const connectionMessage = document.getElementById('connection-message');
const connectionStatusText = document.getElementById('connection-status');
const statusIndicator = document.getElementById('connection-indicator');

let data = { standard: [], groups: [] };
let backendBaseUrl = null;
let isConnected = false;
let syncQueue = Promise.resolve();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function patchTasks(tasks) {
  tasks.forEach(task => {
    if (!task.id) {
      task.id = generateId();
    }
    if (!task.subtasks) {
      task.subtasks = [];
    }
    if (task.subtasks.length > 0 && task.isExpanded === undefined) {
      // Default to expanded for older data
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
  data.groups.forEach(g => {
    if (g.duration && g.duration.value !== undefined) {
      if (g.duration.unit === 'd') {
        g.duration = { days: g.duration.value, hours: 0, minutes: 0 };
      } else if (g.duration.unit === 'h') {
        g.duration = { days: 0, hours: g.duration.value, minutes: 0 };
      }
    }
    if (!Array.isArray(g.tasks)) {
      g.tasks = [];
    }
    patchTasks(g.tasks);
  });
}

function saveLocalData() {
  localStorage.setItem('todo-data', JSON.stringify(data));
}

function updateConnectionStatus(state, message) {
  if (typeof message === 'string') {
    connectionStatusText.textContent = message;
  }
  connectionStatusText.classList.toggle('error', state === 'error');
  statusIndicator.classList.toggle('connected', state === 'connected');
  statusIndicator.classList.toggle('error', state === 'error');
}

function queueBackendSync() {
  if (!isConnected || !backendBaseUrl) {
    return;
  }
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error(`Sync failed with status ${response.status}`);
      }
      updateConnectionStatus('connected', `Connected to ${backendBaseUrl}`);
    } catch (error) {
      console.error('Failed to sync with backend', error);
      updateConnectionStatus('error', 'Sync failed - data stored locally');
    }
  });
}

function saveData() {
  saveLocalData();
  queueBackendSync();
}

function loadLocalData() {
  const saved = localStorage.getItem('todo-data');
  if (saved) {
    try {
      data = JSON.parse(saved);
    } catch (error) {
      console.error('Failed to parse local data, resetting.', error);
      data = { standard: [], groups: [] };
    }
  } else {
    data = { standard: [], groups: [] };
  }
  normaliseData();
  saveLocalData();
}

function refreshConnectButton() {
  if (connectBtn) {
    connectBtn.textContent = isConnected ? 'Reconnect' : 'Connect';
  }
}

function cleanBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

async function connectToBackend(baseUrl, { remember = true } = {}) {
  const normalised = cleanBaseUrl(baseUrl);
  const response = await fetch(`${normalised}/data`);
  if (!response.ok) {
    throw new Error(`Connection failed with status ${response.status}`);
  }
  const payload = await response.json();
  data = payload || { standard: [], groups: [] };
  normaliseData();
  backendBaseUrl = normalised;
  isConnected = true;
  syncQueue = Promise.resolve();
  if (remember) {
    localStorage.setItem('backend-url', normalised);
  }
  saveLocalData();
  updateConnectionStatus('connected', `Connected to ${normalised}`);
  refreshConnectButton();
}

function buildBaseUrl(hostValue, portValue) {
  const trimmedHost = hostValue.trim();
  if (!trimmedHost) {
    throw new Error('Please provide a host name, IP address or URL.');
  }

  if (/^https?:\/\//i.test(trimmedHost)) {
    try {
      const url = new URL(trimmedHost);
      return url.origin;
    } catch (error) {
      throw new Error('The provided URL is not valid.');
    }
  }

  if (/^[^:]+:\/\//.test(trimmedHost)) {
    throw new Error('Only http and https protocols are supported.');
  }

  const hostWithoutTrailing = trimmedHost.replace(/\/+$/, '');
  let resolvedPort = portValue.trim();

  if (!resolvedPort) {
    const colonIndex = hostWithoutTrailing.lastIndexOf(':');
    if (colonIndex > -1) {
      const portCandidate = hostWithoutTrailing.slice(colonIndex + 1);
      if (/^\d+$/.test(portCandidate)) {
        return `http://${hostWithoutTrailing}`;
      }
    }
    throw new Error('Please provide a port number.');
  }

  const portNumber = Number(resolvedPort);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error('Port must be a number between 1 and 65535.');
  }

  return `http://${hostWithoutTrailing}:${portNumber}`;
}

async function attemptInitialConnection() {
  const storedUrl = localStorage.getItem('backend-url');
  if (storedUrl) {
    try {
      await connectToBackend(storedUrl, { remember: false });
      return;
    } catch (error) {
      console.warn('Failed to auto-connect to backend', error);
      backendBaseUrl = cleanBaseUrl(storedUrl);
      isConnected = false;
      updateConnectionStatus('error', 'Connection failed - using local data');
      refreshConnectButton();
    }
  }

  loadLocalData();
  if (!isConnected && !backendBaseUrl) {
    updateConnectionStatus('idle', 'Not connected');
    refreshConnectButton();
  }
}

function closeConnectionModal() {
  if (!connectionModal) {
    return;
  }
  connectionModal.classList.add('hidden');
  connectionMessage.textContent = '';
}

function openConnectionModal() {
  if (!connectionModal) {
    return;
  }
  connectionForm.reset();
  const stored = backendBaseUrl || localStorage.getItem('backend-url') || '';
  if (stored) {
    connectionHostInput.value = stored;
  }
  connectionMessage.textContent = '';
  connectionModal.classList.remove('hidden');
  connectionHostInput.focus();
}

function collectDuration() {
  const days = parseInt(groupDurationDaysInput.value, 10) || 0;
  const hours = parseInt(groupDurationHoursInput.value, 10) || 0;
  const minutes = parseInt(groupDurationMinutesInput.value, 10) || 0;
  return { days, hours, minutes };
}

function durationToMs(dur) {
  return ((dur.days * 24 + dur.hours) * 60 + dur.minutes) * 60 * 1000;
}

function formatDuration(dur) {
  if (dur.days === 1 && dur.hours === 0 && dur.minutes === 0) return 'daily';
  const parts = [];
  if (dur.days) parts.push(dur.days + 'd');
  if (dur.hours) parts.push(dur.hours + 'h');
  if (dur.minutes) parts.push(dur.minutes + 'm');
  if (parts.length === 0) parts.push('0m');
  return parts.join(' ');
}

function nextTime(startTime, duration) {
  const [h, m] = startTime.split(':').map(Number);
  const now = new Date();
  let base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const durMs = durationToMs(duration);
  while (base.getTime() <= now.getTime()) {
    base = new Date(base.getTime() + durMs);
  }
  return base.getTime();
}

function findTaskWithContext(taskId, tasks, parent = null) {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task.id === taskId) {
      return { task, parent, list: tasks, index: i };
    }
    if (task.subtasks && task.subtasks.length > 0) {
      const found = findTaskWithContext(taskId, task.subtasks, task);
      if (found) return found;
    }
  }
  return null;
}

function findTaskById(taskId) {
  for (const category of data.standard) {
    const result = findTaskWithContext(taskId, category.tasks);
    if (result) return result;
  }
  for (const group of data.groups) {
    const result = findTaskWithContext(taskId, group.tasks);
    if (result) return result;
  }
  return null;
}

function propagateStateDown(task, isDone) {
  task.done = isDone;
  task.subtasks.forEach(sub => propagateStateDown(sub, isDone));
}

function propagateStateUp(childId) {
  let context = findTaskById(childId);
  let parent = context ? context.parent : null;

  while (parent) {
    if (parent.subtasks && parent.subtasks.length > 0) {
      const allChildrenDone = parent.subtasks.every(s => s.done);
      if (parent.done === allChildrenDone) {
        break;
      }
      parent.done = allChildrenDone;
    } else {
      break;
    }
    const parentContext = findTaskById(parent.id);
    parent = parentContext ? parentContext.parent : null;
  }
}

let draggedTaskId = null;

function handleDragStart(e) {
  draggedTaskId = this.dataset.taskId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedTaskId);
  setTimeout(() => {
    this.classList.add('dragging');
  }, 0);
}

function handleDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedTaskId = null;
}

function handleDragOver(e) {
  e.preventDefault();
  const targetLi = e.target.closest('li');
  if (targetLi && targetLi.dataset.taskId !== draggedTaskId) {
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    targetLi.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  const targetLi = e.target.closest('li');
  if (targetLi) {
    targetLi.classList.remove('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const targetLi = e.target.closest('li');
  if (!targetLi) return;

  targetLi.classList.remove('drag-over');
  const targetTaskId = targetLi.dataset.taskId;
  const sourceTaskId = e.dataTransfer.getData('text/plain');

  if (!sourceTaskId || sourceTaskId === targetTaskId) return;

  const sourceContext = findTaskById(sourceTaskId);
  const targetContext = findTaskById(targetTaskId);

  if (sourceContext && targetContext && sourceContext.list === targetContext.list) {
    const [removed] = sourceContext.list.splice(sourceContext.index, 1);
    const newTargetIndex = targetContext.list.indexOf(targetContext.task);
    targetContext.list.splice(newTargetIndex, 0, removed);
    saveData();
    renderAll();
  }
}

function makeTaskEditable(span, task) {
  const li = span.parentElement;
  if (!li || li.querySelector('.edit-task-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = task.text;
  input.className = 'edit-task-input';

  const finishEditing = () => {
    const newText = input.value.trim();
    if (newText) {
      task.text = newText;
      saveData();
    }
    renderAll();
  };

  input.addEventListener('blur', finishEditing);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      renderAll();
    }
  });

  li.replaceChild(input, span);
  input.focus();
  input.select();
}

function renderAll() {
  renderStandard();
  renderGroups();
}

function renderTaskTree(tasks, container, onTaskChange, onTaskDelete) {
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.dataset.taskId = task.id;
    li.classList.add('task-item');
    li.setAttribute('draggable', true);

    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('dragleave', handleDragLeave);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);

    if (task.subtasks && task.subtasks.length > 0) {
      const toggle = document.createElement('span');
      toggle.className = 'toggle';
      toggle.textContent = task.isExpanded ? '▾' : '▸';
      toggle.addEventListener('click', () => {
        task.isExpanded = !task.isExpanded;
        saveData();
        renderAll();
      });
      li.appendChild(toggle);
    } else {
      // Add a placeholder for alignment with parent tasks
      const placeholder = document.createElement('span');
      placeholder.className = 'toggle-placeholder';
      li.appendChild(placeholder);
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.done;
    cb.addEventListener('change', () => {
      propagateStateDown(task, cb.checked);
      propagateStateUp(task.id);
      onTaskChange();
    });

    const span = document.createElement('span');
    span.textContent = task.text;
    span.className = 'task-text';
    span.addEventListener('click', () => {
      window.location.href = `subtask.html?taskId=${task.id}`;
    });
    span.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      makeTaskEditable(span, task);
    });

    li.appendChild(cb);
    li.appendChild(span);

    if (onTaskDelete) {
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.classList.add('icon-button', 'destructive-button');
      delBtn.setAttribute('aria-label', 'Delete task');
      delBtn.addEventListener('click', () => onTaskDelete(task.id));
      li.appendChild(delBtn);
    }

    container.appendChild(li);

    if (task.isExpanded && task.subtasks && task.subtasks.length > 0) {
      const sublist = document.createElement('ul');
      sublist.className = 'nested-task-list';
      li.appendChild(sublist);
      renderTaskTree(task.subtasks, sublist, onTaskChange, null);
    }
  });
}

function renderStandard() {
  categoryGrid.innerHTML = '';

  if (data.standard.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Create a category to start adding tasks.';
    categoryGrid.appendChild(emptyState);
    return;
  }

  data.standard.forEach((category, cidx) => {
    const column = document.createElement('div');
    column.className = 'category-column';
    column.dataset.categoryId = category.id;

    const header = document.createElement('div');
    header.className = 'category-header';

    const title = document.createElement('h3');
    title.textContent = category.name;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'category-delete-btn';
    deleteBtn.classList.add('secondary-button', 'destructive-button');
    deleteBtn.textContent = 'Remove';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete the category "${category.name}" and all of its tasks?`)) {
        data.standard.splice(cidx, 1);
        saveData();
        renderAll();
      }
    });

    header.appendChild(title);
    header.appendChild(deleteBtn);
    column.appendChild(header);

    const body = document.createElement('div');
    body.className = 'category-body';

    const list = document.createElement('ul');
    list.className = 'category-task-list';

    const onTaskChange = () => {
      saveData();
      renderAll();
    };

    const onTaskDelete = (taskId) => {
      const context = findTaskById(taskId);
      if (context) {
        context.list.splice(context.index, 1);
        saveData();
        renderAll();
      }
    };

    renderTaskTree(category.tasks, list, onTaskChange, onTaskDelete);

    body.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'category-add-row stack-on-small';

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = `Add a task in ${category.name}`;

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Task';
    addBtn.classList.add('secondary-button');

    const addTaskToCategory = () => {
      const text = addInput.value.trim();
      if (!text) return;
      category.tasks.push({ id: generateId(), text, done: false, subtasks: [] });
      addInput.value = '';
      saveData();
      renderAll();
    };

    addBtn.addEventListener('click', addTaskToCategory);
    addInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTaskToCategory();
      }
    });

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    column.appendChild(body);
    categoryGrid.appendChild(column);
  });
}

function allTasksDone(tasks) {
  return tasks.every(t => t.done && allTasksDone(t.subtasks));
}

function updateGroupState(group, box) {
  const allDone = group.tasks.length > 0 && allTasksDone(group.tasks);
  if (allDone) {
    box.classList.add('done');
  } else {
    box.classList.remove('done');
  }
}

function renderGroups() {
  groupsDiv.innerHTML = '';
  data.groups.forEach((group, gidx) => {
    const box = document.createElement('div');
    box.className = 'group-box';
    const header = document.createElement('div');
    header.className = 'group-header';
    const title = document.createElement('span');
    title.textContent = group.name;

    const headerRight = document.createElement('div');
    headerRight.className = 'group-header-actions';

    const period = document.createElement('span');
    period.className = 'group-period';
    period.textContent = formatDuration(group.duration);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete Group';
    deleteBtn.classList.add('secondary-button', 'destructive-button');
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete the group "${group.name}"?`)) {
        data.groups.splice(gidx, 1);
        saveData();
        renderAll();
      }
    });

    headerRight.appendChild(period);
    headerRight.appendChild(deleteBtn);

    header.appendChild(title);
    header.appendChild(headerRight);
    box.appendChild(header);

    const list = document.createElement('ul');
    const onTaskChange = () => {
      updateGroupState(group, box);
      saveData();
      renderAll();
    };
    const onTaskDelete = (taskId) => {
      const context = findTaskById(taskId);
      if (context) {
        context.list.splice(context.index, 1);
        saveData();
        renderAll();
      }
    };
    renderTaskTree(group.tasks, list, onTaskChange, onTaskDelete);

    const addWrapper = document.createElement('div');
    addWrapper.className = 'category-add-row stack-on-small';

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.placeholder = 'New task';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Task';
    addBtn.classList.add('secondary-button');
    const addTaskToGroup = () => {
      if (addInput.value.trim()) {
        group.tasks.push({ id: generateId(), text: addInput.value.trim(), done: false, subtasks: [] });
        addInput.value = '';
        saveData();
        renderAll();
      }
    };
    addBtn.addEventListener('click', addTaskToGroup);
    addInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTaskToGroup();
      }
    });
    addWrapper.appendChild(addInput);
    addWrapper.appendChild(addBtn);
    box.appendChild(list);
    box.appendChild(addWrapper);

    updateGroupState(group, box);
    groupsDiv.appendChild(box);
  });
}

const addCategory = () => {
  const name = newCategoryNameInput.value.trim();
  if (!name) {
    newCategoryNameInput.focus();
    return;
  }
  data.standard.push({ id: generateId(), name, tasks: [] });
  newCategoryNameInput.value = '';
  saveData();
  renderAll();
};

addCategoryBtn.addEventListener('click', addCategory);
newCategoryNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addCategory();
  }
});

addGroupBtn.addEventListener('click', () => {
  const name = groupNameInput.value.trim();
  const start = groupStartInput.value;
  const duration = collectDuration();
  if (name && start && durationToMs(duration) > 0) {
    data.groups.push({
      name,
      start,
      duration,
      tasks: [],
      next: nextTime(start, duration)
    });
    groupNameInput.value = '';
    groupStartInput.value = '';
    groupDurationDaysInput.value = '';
    groupDurationHoursInput.value = '';
    groupDurationMinutesInput.value = '';
    saveData();
    renderAll();
  } else {
    alert('Please provide name, start time and a valid duration.');
  }
});

if (connectBtn) {
  connectBtn.addEventListener('click', () => {
    openConnectionModal();
  });
}

if (connectionCancelBtn) {
  connectionCancelBtn.addEventListener('click', () => {
    closeConnectionModal();
  });
}

if (connectionModal) {
  connectionModal.addEventListener('click', (event) => {
    if (event.target === connectionModal) {
      closeConnectionModal();
    }
  });
}

if (connectionForm) {
  connectionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const hostValue = connectionHostInput.value;
    const portValue = connectionPortInput.value || '';
    try {
      const baseUrl = buildBaseUrl(hostValue, portValue);
      connectionMessage.textContent = 'Connecting...';
      await connectToBackend(baseUrl);
      connectionMessage.textContent = '';
      closeConnectionModal();
      renderAll();
    } catch (error) {
      console.error('Connection attempt failed', error);
      isConnected = false;
      updateConnectionStatus('error', 'Connection failed - using local data');
      refreshConnectButton();
      connectionMessage.textContent = error && error.message ? error.message : 'Connection failed. Please verify the host and port.';
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && connectionModal && !connectionModal.classList.contains('hidden')) {
    closeConnectionModal();
  }
});

function checkRenewal() {
  const now = Date.now();
  data.groups.forEach(group => {
    if (now >= group.next) {
      group.tasks.forEach(t => { propagateStateDown(t, false); });
      group.next = nextTime(group.start, group.duration);
    }
  });
  saveData();
  renderAll();
}

// New: Clear All Data Functionality
clearDataBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear ALL your To-Do data? This action cannot be undone.')) {
    localStorage.removeItem('todo-data');
    data = { standard: [], groups: [] };
    normaliseData();
    renderAll();
    saveData();
    alert('All data has been cleared.');
  }
});

async function initialiseApp() {
  await attemptInitialConnection();
  renderAll();
  setInterval(checkRenewal, 60000); // check every minute
}

initialiseApp();
