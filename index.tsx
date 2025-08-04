import { GoogleGenAI, Type } from "@google/genai";

// --- STATE MANAGEMENT ---
type Priority = 1 | 2 | 3 | 4 | 5;

interface Task {
  id: string;
  title: string;
  notes: string;
  priority: Priority;
  completed: boolean;
  dueDate?: string;
}

interface MoodLog {
    mood: number;
    date: string;
}

let tasks: Task[] = JSON.parse(localStorage.getItem('tasks') || '[]');
let moodLogs: MoodLog[] = JSON.parse(localStorage.getItem('moodLogs') || '[]');
let currentMood: number = 4;
let activeScreen: string = 'tasks';
let currentTheme: 'light' | 'dark' = 'light';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- DOM ELEMENTS ---
const bodyEl = document.body;
const taskListEl = document.getElementById('tasks-list')!;
const completedTaskListEl = document.getElementById('completed-tasks-list')!;
const suggestedTaskListEl = document.getElementById('suggested-tasks-list')!;
const suggestionLoaderEl = document.getElementById('suggestion-loader')!;

const addTaskBtn = document.getElementById('add-task-btn')!;
const modalEl = document.getElementById('task-modal')!;
const modalTitleEl = document.getElementById('modal-title')!;
const taskForm = document.getElementById('task-form') as HTMLFormElement;
const cancelBtn = document.getElementById('cancel-btn')!;
const deleteTaskBtn = document.getElementById('delete-task-btn')!;
const taskIdInput = document.getElementById('task-id') as HTMLInputElement;
const taskTitleModalInput = document.getElementById('task-title-modal') as HTMLInputElement;
const taskNotesModalInput = document.getElementById('task-notes-modal') as HTMLTextAreaElement;
const taskPriorityModalInput = document.getElementById('task-priority-modal') as HTMLSelectElement;
const taskDateModalInput = document.getElementById('task-date-modal') as HTMLInputElement;

const quickAddForm = document.getElementById('quick-add-form') as HTMLFormElement;
const quickAddInput = document.getElementById('quick-add-input') as HTMLInputElement;

const moodSlider = document.getElementById('mood-slider') as HTMLInputElement;
const moodEmojiSpan = document.getElementById('mood-emoji')!;
const completedToggle = document.getElementById('completed-toggle')!;

const navItems = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');

const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
const moodChartEl = document.getElementById('mood-chart')!;
const moodStatsEl = document.getElementById('mood-stats')!;

// --- RENDER FUNCTIONS ---
const renderTasks = () => {
  taskListEl.innerHTML = '';
  completedTaskListEl.innerHTML = '';
  
  let uncompletedTasks = tasks.filter(task => !task.completed);
  const completedTasks = tasks.filter(task => task.completed);
  
  // Sort uncompleted tasks: by due date (asc), then by priority (desc)
  uncompletedTasks.sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      const dateA = new Date(a.dueDate).getTime();
      const dateB = new Date(b.dueDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.priority - a.priority;
  });

  if (uncompletedTasks.length === 0) {
      taskListEl.innerHTML = '<p class="typography_body">Brak zadań. Czas na relaks!</p>';
  } else {
    uncompletedTasks.forEach(task => {
        const taskEl = createTaskElement(task);
        taskListEl.appendChild(taskEl);
    });
  }
  
  if (completedTasks.length > 0) {
      completedToggle.style.display = 'flex';
      completedTasks.forEach(task => {
          const taskEl = createTaskElement(task);
          completedTaskListEl.appendChild(taskEl);
      });
  } else {
      completedToggle.style.display = 'none';
  }
};

const createTaskElement = (task: Task) => {
  const div = document.createElement('div');
  div.className = `task-item ${task.completed ? 'completed' : ''}`;
  div.dataset.id = task.id;

  const datePreview = task.dueDate ? `<div class="task-date-preview">${new Date(task.dueDate).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}</div>` : '';

  div.innerHTML = `
    <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-task-id="${task.id}" aria-label="Oznacz zadanie jako ukończone">
        <i class="ph-bold ph-check"></i>
    </div>
    <div class="task-content">
      <p class="task-title">${task.title}</p>
      ${datePreview}
    </div>
    <div class="task-priority" data-priority="${task.priority}" title="Priorytet: ${task.priority}"></div>
  `;

  div.addEventListener('click', () => openModal(task));
  
  div.querySelector('.task-checkbox')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTaskCompletion(task.id);
  });

  return div;
};

const renderSuggestedTasks = (suggestions: { tytul: string, notatki: string, priorytet: Priority }[]) => {
    suggestedTaskListEl.innerHTML = '';
    suggestions.forEach(suggestion => {
        const div = document.createElement('div');
        div.className = 'task-item';
        div.innerHTML = `
            <div class="task-add-suggestion" aria-label="Dodaj sugerowane zadanie">
                <i class="ph-bold ph-plus-circle" style="color: var(--kih-primary); font-size: 1.5rem; cursor: pointer;"></i>
            </div>
            <div class="task-content">
                <p class="task-title">${suggestion.tytul}</p>
                ${suggestion.notatki ? `<p class="task-notes-preview">${suggestion.notatki}</p>`: ''}
            </div>
            <div class="task-priority" data-priority="${suggestion.priorytet}" title="Sugerowany priorytet: ${suggestion.priorytet}"></div>
        `;
        div.querySelector('.task-add-suggestion')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addTask(suggestion.tytul, suggestion.notatki, suggestion.priorytet);
            div.style.display = 'none'; // Hide suggestion after adding
        });
        suggestedTaskListEl.appendChild(div);
    });
};

const renderMoodAnalysis = () => {
    moodChartEl.innerHTML = '';
    moodStatsEl.innerHTML = '';

    const today = new Date();
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();

    const dailyAverages = last7Days.map(dateStr => {
        const moodsForDay = moodLogs.filter(log => log.date === dateStr).map(log => log.mood);
        const avg = moodsForDay.length > 0 ? moodsForDay.reduce((a, b) => a + b, 0) / moodsForDay.length : 0;
        return { date: dateStr, avgMood: avg };
    });
    
    let totalMoodSum = 0;
    let moodCount = 0;

    dailyAverages.forEach(day => {
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.height = `${day.avgMood * 20}%`; // Scale mood 1-5 to 20-100% height
        
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = new Date(day.date).toLocaleDateString('pl-PL', { weekday: 'short' });
        bar.appendChild(label);
        
        moodChartEl.appendChild(bar);
        
        if (day.avgMood > 0) {
            totalMoodSum += day.avgMood;
            moodCount++;
        }
    });

    const overallAverage = moodCount > 0 ? (totalMoodSum / moodCount).toFixed(1) : 'Brak danych';
    moodStatsEl.innerHTML = `<p>Średni nastrój w tym tygodniu: <strong>${overallAverage}</strong></p>`;
};


// --- API & AI FUNCTIONS ---
const getSuggestedTasks = async () => {
    suggestionLoaderEl.style.display = 'flex';
    suggestedTaskListEl.innerHTML = '';
    try {
        const prompt = `Jesteś Dr Kiwi, empatycznym, ale wymagającym trenerem zdrowia. Na podstawie nastroju użytkownika (skala 1-5, gdzie 1 to zły, a 5 świetny) i jego istniejącej listy zadań, zaproponuj 2 krótkie, motywujące zadania prozdrowotne. Dla każdej sugestii podaj również sugerowany priorytet (1-5). Mów krótko, w 2. osobie l. poj., użyj 1-2 emoji. Nastrój: ${currentMood}. Istniejące zadania: ${tasks.map(t => t.title).join(', ')}.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        sugestie: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    tytul: { type: Type.STRING },
                                    notatki: { type: Type.STRING },
                                    priorytet: { type: Type.INTEGER }
                                }
                            }
                        }
                    }
                }
            }
        });
        
        const jsonResponse = JSON.parse(response.text);
        renderSuggestedTasks(jsonResponse.sugestie);

    } catch (error) {
        console.error("Error fetching suggestions:", error);
        suggestedTaskListEl.innerHTML = `<p class="typography_body">Nie udało się pobrać sugestii.</p>`;
    } finally {
        suggestionLoaderEl.style.display = 'none';
    }
};


// --- CRUD & APP LOGIC ---
const saveState = () => {
  localStorage.setItem('tasks', JSON.stringify(tasks));
  localStorage.setItem('moodLogs', JSON.stringify(moodLogs));
  renderTasks();
};

const addTask = (title: string, notes: string, priority: Priority, dueDate?: string) => {
  const newTask: Task = { id: Date.now().toString(), title, notes, priority, completed: false, dueDate };
  tasks.push(newTask);
  saveState();
};

const updateTask = (id: string, title: string, notes: string, priority: Priority, dueDate?: string) => {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.title = title;
    task.notes = notes;
    task.priority = priority;
    task.dueDate = dueDate;
    saveState();
  }
};

const deleteTask = (id: string) => {
    tasks = tasks.filter(t => t.id !== id);
    saveState();
    closeModal();
};

const toggleTaskCompletion = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveState();
    }
};

const openModal = (task: Task | null = null) => {
  taskForm.reset();
  if (task) {
    modalTitleEl.textContent = 'Edytuj zadanie';
    taskIdInput.value = task.id;
    taskTitleModalInput.value = task.title;
    taskNotesModalInput.value = task.notes;
    taskPriorityModalInput.value = String(task.priority);
    taskDateModalInput.value = task.dueDate || '';
    deleteTaskBtn.style.display = 'flex';
  } else {
    modalTitleEl.textContent = 'Nowe zadanie';
    taskIdInput.value = '';
    deleteTaskBtn.style.display = 'none';
  }
  modalEl.style.display = 'flex';
};

const closeModal = () => {
  modalEl.style.display = 'none';
};

const handleFormSubmit = (e: Event) => {
  e.preventDefault();
  const id = taskIdInput.value;
  const title = taskTitleModalInput.value.trim();
  const notes = taskNotesModalInput.value.trim();
  const priority = parseInt(taskPriorityModalInput.value, 10) as Priority;
  const dueDate = taskDateModalInput.value;

  if (!title) return;

  if (id) {
    updateTask(id, title, notes, priority, dueDate);
  } else {
    addTask(title, notes, priority, dueDate);
  }
  closeModal();
};

const handleQuickAdd = (e: Event) => {
    e.preventDefault();
    const title = quickAddInput.value.trim();
    if (title) {
        addTask(title, '', 3); // Default priority 3
        quickAddInput.value = '';
    }
};

const logMood = (moodValue: number) => {
    const todayStr = new Date().toISOString().split('T')[0];
    moodLogs.push({ mood: moodValue, date: todayStr });
    // Keep logs for the last 30 days for performance
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    moodLogs = moodLogs.filter(log => new Date(log.date) >= thirtyDaysAgo);
    saveState();
    renderMoodAnalysis();
};

const updateMoodUI = (value: string) => {
    currentMood = parseInt(value, 10);
    const emojis = ['😟', '😐', '🙂', '😊', '🤩'];
    moodEmojiSpan.textContent = emojis[currentMood - 1];
};

const switchScreen = (screenId: string) => {
    activeScreen = screenId;
    screens.forEach(screen => {
        (screen as HTMLElement).style.display = screen.id === `screen-${screenId}` ? 'flex' : 'none';
    });
    navItems.forEach(item => {
        const itemScreen = (item as HTMLElement).dataset.screen;
        const isActive = itemScreen === screenId;
        item.classList.toggle('active', isActive);
        const icon = item.querySelector('i');
        if (icon) {
            if (isActive) {
                // For active item, ensure icon is bold
                icon.classList.remove('ph');
                icon.classList.add('ph-bold');
            } else {
                // For inactive item, ensure icon is regular
                icon.classList.remove('ph-bold');
                icon.classList.add('ph');
            }
        }
    });

    if (screenId === 'mood') {
        renderMoodAnalysis();
    }
};

const toggleTheme = () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    bodyEl.dataset.theme = currentTheme;
    localStorage.setItem('theme', currentTheme);
};

// --- EVENT LISTENERS ---
addTaskBtn.addEventListener('click', () => openModal());
cancelBtn.addEventListener('click', closeModal);
modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
});
taskForm.addEventListener('submit', handleFormSubmit);
quickAddForm.addEventListener('submit', handleQuickAdd);
deleteTaskBtn.addEventListener('click', () => {
    if (confirm('Czy na pewno chcesz usunąć to zadanie?')) {
        deleteTask(taskIdInput.value);
    }
});

moodSlider.addEventListener('input', (e) => updateMoodUI((e.target as HTMLInputElement).value));
moodSlider.addEventListener('change', (e) => {
    const moodValue = parseInt((e.target as HTMLInputElement).value, 10);
    logMood(moodValue);
    getSuggestedTasks();
});

completedToggle.addEventListener('click', () => {
    const isVisible = completedTaskListEl.style.display !== 'none';
    completedTaskListEl.style.display = isVisible ? 'none' : 'flex';
    completedToggle.querySelector('i')?.classList.toggle('ph-caret-up', !isVisible);
    completedToggle.querySelector('i')?.classList.toggle('ph-caret-down', isVisible);
});

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const screenId = (e.currentTarget as HTMLElement).dataset.screen;
        if (screenId) {
            switchScreen(screenId);
        }
    });
});

themeToggle.addEventListener('change', toggleTheme);


// --- INITIALIZATION ---
const initTheme = () => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
        currentTheme = savedTheme;
    } else {
        currentTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    bodyEl.dataset.theme = currentTheme;
    themeToggle.checked = currentTheme === 'dark';
};

const init = () => {
  initTheme();
  updateMoodUI(moodSlider.value);
  renderTasks();
  getSuggestedTasks();
  switchScreen('tasks');
};

init();