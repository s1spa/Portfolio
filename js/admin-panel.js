// ============================================================================
// ADMIN-PANEL.JS
// ============================================================================

// Глобальні змінні
let projectsData = { projects: [] };
let editingProjectId = null;
let aboutData = { profile: {}, skills: {}, education: [], goals: {}, contacts: {} };

// ============================================================================
// FILE SYSTEM ACCESS API — пряме збереження в папку проєкту
// ============================================================================

// projectDirHandle встановлюється ТІЛЬКИ через connectFolder() (явний клік)
// або через tryRestoreDirHandle() при завантаженні (тихо, без діалогів)
let projectDirHandle = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('portfolioAdmin', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}

async function storeDirHandle(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'projectDir');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function getStoredDirHandle() {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('projectDir');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    });
}

// Викликається при завантаженні сторінки.
// queryPermission НЕ потребує user gesture — тихо перевіряємо чи є доступ.
async function tryRestoreDirHandle() {
    if (!window.showDirectoryPicker) return;
    try {
        const stored = await getStoredDirHandle();
        if (!stored) return;
        const perm = await stored.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
            projectDirHandle = stored;
            updateDirStatus();
        }
        // perm === 'prompt' — дозвіл є але потребує підтвердження,
        // буде запитано при наступному connectFolder() через requestPermission
    } catch (_) {}
}

// Викликається ТІЛЬКИ по кнопці — user gesture гарантований
async function connectFolder() {
    if (!window.showDirectoryPicker) {
        showAlert('error', '❌ Твій браузер не підтримує цю функцію. Потрібен Chrome або Edge.');
        return;
    }
    try {
        // Якщо є збережений handle — спершу просимо дозвіл на нього (менш інвазивно)
        const stored = await getStoredDirHandle();
        if (stored) {
            const perm = await stored.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                projectDirHandle = stored;
                updateDirStatus();
                showAlert('success', `✅ Папка "${stored.name}" підключена!`);
                return;
            }
        }
        // Інакше — відкриваємо picker
        const handle = await window.showDirectoryPicker({ id: 'portfolioProject', mode: 'readwrite' });
        projectDirHandle = handle;
        await storeDirHandle(handle);
        updateDirStatus();
        showAlert('success', `✅ Папка "${handle.name}" підключена! Тепер зміни зберігаються автоматично.`);
    } catch (e) {
        if (e.name !== 'AbortError') showAlert('error', '❌ Не вдалось підключити папку: ' + e.message);
    }
}

function updateDirStatus() {
    const label = document.getElementById('dir-status-label');
    if (!label) return;
    if (projectDirHandle) {
        label.textContent = `✅ Папка "${projectDirHandle.name}" підключена — зміни зберігаються автоматично`;
        label.className = 'dir-status-label connected';
    } else {
        label.textContent = '📁 Папка не підключена — зміни зберігаються тільки в браузері';
        label.className = 'dir-status-label disconnected';
    }
}

async function handleResumeUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    if (!projectDirHandle) {
        showAlert('error', '❌ Спочатку підключи папку проєкту (кнопка "🔗 Підключити папку")');
        return;
    }
    try {
        const perm = await projectDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            showAlert('error', '❌ Немає дозволу на запис у папку');
            return;
        }
        const filesDir = await projectDirHandle.getDirectoryHandle('files', { create: true });
        const fileHandle = await filesDir.getFileHandle('resume.pdf', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
        document.getElementById('resume-status').innerHTML = '✅ Резюме збережено: <code>files/resume.pdf</code>';
        showAlert('success', '✅ resume.pdf збережено!');
    } catch (e) {
        showAlert('error', '❌ Помилка: ' + e.message);
    }
}

async function trySaveAboutToFile() {
    if (!projectDirHandle) return false;
    try {
        const perm = await projectDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return false;
        const dataDir = await projectDirHandle.getDirectoryHandle('data');
        const fileHandle = await dataDir.getFileHandle('about.json');
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(aboutData, null, 2));
        await writable.close();
        return true;
    } catch (e) {
        console.warn('FS write failed:', e.message);
        return false;
    }
}

// Записує projectsData у файл. НЕ показує picker — тільки пише якщо handle є.
async function trySaveProjectsToFile() {
    if (!projectDirHandle) return false;
    try {
        const perm = await projectDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return false;
        const dataDir = await projectDirHandle.getDirectoryHandle('data');
        const fileHandle = await dataDir.getFileHandle('projects.json');
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(projectsData, null, 2));
        await writable.close();
        return true;
    } catch (e) {
        console.warn('FS write failed:', e.message);
        return false;
    }
}

function sanitizeTitle(title) {
    return (title || 'Project').replace(/\s+/g, '').replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄ_-]/g, '') || 'Project';
}

async function copyImageFile(file, projectTitle) {
    if (!projectDirHandle) throw new Error('no-dir');
    const folderName = sanitizeTitle(projectTitle);
    const imagesDir = await projectDirHandle.getDirectoryHandle('images', { create: true });
    const projectsDir = await imagesDir.getDirectoryHandle('projects', { create: true });
    const projectImgDir = await projectsDir.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await projectImgDir.getFileHandle(file.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return `images/projects/${folderName}/${file.name}`;
}

// ============================================================================
// СТАН ЗОБРАЖЕНЬ В МОДАЛЦІ
// ============================================================================

let mainImageState = { path: '', file: null, blobUrl: null };
let galleryItems = []; // { path, file, blobUrl }

function initEditState(project) {
    // Звільнити попередні blob URLs
    if (mainImageState.file) URL.revokeObjectURL(mainImageState.blobUrl);
    galleryItems.filter(i => i.file).forEach(i => URL.revokeObjectURL(i.blobUrl));

    if (project) {
        mainImageState = { path: project.mainImage || '', file: null, blobUrl: project.mainImage || null };
        galleryItems = (project.gallery || []).map(p => ({ path: p, file: null, blobUrl: p }));
    } else {
        mainImageState = { path: '', file: null, blobUrl: null };
        galleryItems = [];
    }

    renderMainImagePreview();
    renderGalleryGrid();
}

function renderMainImagePreview() {
    const box = document.getElementById('main-image-preview');
    if (!box) return;
    if (mainImageState.blobUrl) {
        box.innerHTML = `
            <div class="preview-item">
                <img src="${mainImageState.blobUrl}" alt="main">
                <button type="button" class="remove-img-btn" onclick="removeMainImage()">✕</button>
            </div>`;
    } else {
        box.innerHTML = '<span class="preview-empty">Немає зображення</span>';
    }
}

function removeMainImage() {
    if (mainImageState.file) URL.revokeObjectURL(mainImageState.blobUrl);
    mainImageState = { path: '', file: null, blobUrl: null };
    renderMainImagePreview();
}

function handleMainImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (mainImageState.file) URL.revokeObjectURL(mainImageState.blobUrl);
    mainImageState = { path: '', file, blobUrl: URL.createObjectURL(file) };
    renderMainImagePreview();
    event.target.value = '';
}

function renderGalleryGrid() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    if (galleryItems.length === 0) {
        grid.innerHTML = '<span class="preview-empty">Немає зображень</span>';
        return;
    }
    grid.innerHTML = galleryItems.map((item, i) => `
        <div class="preview-item">
            <img src="${item.blobUrl}" alt="gallery ${i}">
            <button type="button" class="remove-img-btn" onclick="removeGalleryItem(${i})">✕</button>
        </div>
    `).join('');
}

function removeGalleryItem(index) {
    const item = galleryItems[index];
    if (item.file) URL.revokeObjectURL(item.blobUrl);
    galleryItems.splice(index, 1);
    renderGalleryGrid();
}

function handleGalleryAdd(event) {
    Array.from(event.target.files).forEach(file => {
        galleryItems.push({ path: '', file, blobUrl: URL.createObjectURL(file) });
    });
    renderGalleryGrid();
    event.target.value = '';
}

// ============================================================================
// НАВІГАЦІЯ
// ============================================================================

function selectFile(fileType) {
    document.getElementById('file-selector').style.display = 'none';

    if (fileType === 'projects') {
        document.getElementById('projects-editor').classList.add('active');
        loadProjectsFromLocalStorage();
        renderProjectsList();
        updateProjectsExport();
        fetchProjectsFromServer();
    } else if (fileType === 'about') {
        document.getElementById('about-editor').classList.add('active');
        loadAboutFromLocalStorage();
        renderAboutPreview();
        updateAboutExport();
        fetchAboutFromServer();
    }
}

function backToSelector() {
    document.getElementById('file-selector').style.display = 'grid';
    document.getElementById('projects-editor').classList.remove('active');
    document.getElementById('about-editor').classList.remove('active');
}

// ============================================================================
// PROJECTS — ЗАВАНТАЖЕННЯ
// ============================================================================

async function fetchProjectsFromServer() {
    try {
        const response = await fetch('data/projects.json');
        if (!response.ok) return;
        const data = await response.json();
        projectsData = data;
        localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
        renderProjectsList();
        updateProjectsExport();
    } catch (_) {}
}

function loadProjectsFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            projectsData = JSON.parse(e.target.result);
            localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
            renderProjectsList();
            updateProjectsExport();
            showAlert('success', '✅ Файл projects.json завантажено!');
        } catch (_) {
            showAlert('error', '❌ Невірний формат JSON');
        }
    };
    reader.readAsText(file);
}

function loadProjectsFromLocalStorage() {
    const saved = localStorage.getItem('portfolioProjects');
    if (saved) {
        try { projectsData = JSON.parse(saved); } catch (_) {}
    }
}

function resetProjects() {
    if (confirm('⚠️ Видалити ВСІ проєкти?')) {
        projectsData = { projects: [] };
        localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
        renderProjectsList();
        updateProjectsExport();
        showAlert('warning', '🗑️ Всі проєкти видалено');
    }
}

// ============================================================================
// ABOUT — ЗАВАНТАЖЕННЯ
// ============================================================================

async function fetchAboutFromServer() {
    try {
        const response = await fetch('data/about.json');
        if (!response.ok) return;
        const data = await response.json();
        aboutData = data;
        localStorage.setItem('portfolioAbout', JSON.stringify(aboutData));
        renderAboutPreview();
        updateAboutExport();
        // Оновити форму редагування якщо вона вже відкрита
        if (document.getElementById('about-edit-tab')?.classList.contains('active')) {
            renderAboutEditForm();
        }
    } catch (_) {}
}

function loadAboutFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            aboutData = JSON.parse(e.target.result);
            localStorage.setItem('portfolioAbout', JSON.stringify(aboutData));
            renderAboutPreview();
            updateAboutExport();
            showAlert('success', '✅ Файл about.json завантажено!');
        } catch (_) {
            showAlert('error', '❌ Невірний формат JSON');
        }
    };
    reader.readAsText(file);
}

function loadAboutFromLocalStorage() {
    const saved = localStorage.getItem('portfolioAbout');
    if (saved) {
        try { aboutData = JSON.parse(saved); } catch (_) {}
    }
}

function resetAbout() {
    if (confirm('⚠️ Видалити ВСІ дані профілю?')) {
        aboutData = { profile: {}, skills: {}, education: [], goals: {}, contacts: {} };
        localStorage.setItem('portfolioAbout', JSON.stringify(aboutData));
        renderAboutPreview();
        updateAboutExport();
        showAlert('warning', '🗑️ Дані профілю видалено');
    }
}

// ============================================================================
// ТАББИ
// ============================================================================

function switchProjectTab(tab) {
    document.querySelectorAll('#projects-editor .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#projects-editor .tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`projects-${tab}-tab`).classList.add('active');
    if (tab === 'export') updateProjectsExport();
}

function switchAboutTab(tab) {
    document.querySelectorAll('#about-editor .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#about-editor .tab-content').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById(`about-${tab}-tab`).classList.add('active');
    if (tab === 'export') updateAboutExport();
    if (tab === 'edit') renderAboutEditForm();
}

// ============================================================================
// PROJECTS — РЕНДЕРИНГ
// ============================================================================

function renderProjectsList() {
    const container = document.getElementById('projects-list');
    if (!projectsData.projects || projectsData.projects.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:3rem;color:var(--text-secondary);">
                <p style="font-size:1.2rem;margin-bottom:0.5rem;">📂 Поки що немає проєктів</p>
                <p>Натисни "Додати проєкт" вище</p>
            </div>`;
        return;
    }
    container.innerHTML = projectsData.projects.map((p, i) => `
        <div class="project-item" data-project-id="${p.id}">
            <div class="project-info">
                <h3>${p.title?.uk || p.title?.en || 'Без назви'}</h3>
                <p>${p.shortDescription?.uk || p.description?.uk || 'Опис відсутній'}</p>
                <div class="project-tags">
                    ${(p.technologies || []).map(t => `<span class="tag">${t}</span>`).join('')}
                    ${p.featured ? '<span class="tag featured">⭐ Featured</span>' : ''}
                    ${p.status ? `<span class="tag">${p.status}</span>` : ''}
                </div>
            </div>
            <div class="project-actions">
                <button onclick="moveProject(${p.id}, -1)" data-move="${p.id}:-1" class="btn btn-secondary" ${i === 0 ? 'disabled' : ''} title="Перемістити вгору">⬆️</button>
                <button onclick="moveProject(${p.id}, 1)" data-move="${p.id}:1" class="btn btn-secondary" ${i === projectsData.projects.length - 1 ? 'disabled' : ''} title="Перемістити вниз">⬇️</button>
                <button onclick="editProject(${p.id})" class="btn btn-secondary">✏️ Редагувати</button>
                <button onclick="deleteProject(${p.id})" class="btn btn-danger">🗑️ Видалити</button>
            </div>
        </div>
    `).join('');
}

async function moveProject(id, direction) {
    const index = projectsData.projects.findIndex(p => p.id === id);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= projectsData.projects.length) return;
    const [moved] = projectsData.projects.splice(index, 1);
    projectsData.projects.splice(targetIndex, 0, moved);
    localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
    renderProjectsList();
    updateProjectsExport();

    const row = document.querySelector(`.project-item[data-project-id="${id}"]`);
    if (row) {
        row.scrollIntoView({ block: 'nearest' });
        row.classList.add('just-moved');
        setTimeout(() => row.classList.remove('just-moved'), 600);
    }
    document.querySelector(`[data-move="${id}:${direction}"]`)?.focus();
    await trySaveProjectsToFile();
}

async function deleteProject(id) {
    if (!confirm('Видалити цей проєкт?')) return;
    const index = projectsData.projects.findIndex(p => p.id === id);
    if (index === -1) return;
    projectsData.projects.splice(index, 1);
    localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
    renderProjectsList();
    updateProjectsExport();
    const deleted = await trySaveProjectsToFile();
    showAlert('success', deleted ? '🗑️ Проєкт видалено!' : '🗑️ Видалено (скачай JSON вручну)');
}

// ============================================================================
// ABOUT — РЕНДЕРИНГ
// ============================================================================

function renderAboutPreview() {
    const container = document.getElementById('about-preview');
    if (!aboutData.profile || Object.keys(aboutData.profile).length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:3rem;color:var(--text-secondary);">
                <p>👤 Немає даних профілю</p>
            </div>`;
        return;
    }
    const { profile = {}, skills = {}, education = [], goals = {}, contacts = {} } = aboutData;
    container.innerHTML = `
        <div style="background:var(--bg-card);padding:2rem;border-radius:var(--border-radius);border:1px solid var(--border);margin-bottom:1rem;">
            <h4 style="color:var(--accent);margin-bottom:1rem;">👤 Профіль</h4>
            <p><strong>Ім'я (UA):</strong> ${profile.name?.uk || '—'}</p>
            <p><strong>Ім'я (EN):</strong> ${profile.name?.en || '—'}</p>
            <p><strong>Вік:</strong> ${profile.age || '—'}</p>
            <p><strong>Біо параграфів (UA):</strong> ${profile.bio?.uk?.length || 0}</p>
        </div>
        <div style="background:var(--bg-card);padding:2rem;border-radius:var(--border-radius);border:1px solid var(--border);margin-bottom:1rem;">
            <h4 style="color:var(--accent);margin-bottom:1rem;">💻 Навички</h4>
            <p><strong>Категорій:</strong> ${Object.keys(skills).length}</p>
            ${Object.entries(skills).map(([k, c]) => `<p style="margin-left:1rem;">• ${c.title?.uk || k}: ${c.items?.length || 0} навичок</p>`).join('')}
        </div>
        <div style="background:var(--bg-card);padding:2rem;border-radius:var(--border-radius);border:1px solid var(--border);margin-bottom:1rem;">
            <h4 style="color:var(--accent);margin-bottom:1rem;">📚 Освіта</h4>
            <p><strong>Записів:</strong> ${education.length}</p>
        </div>
        <div style="background:var(--bg-card);padding:2rem;border-radius:var(--border-radius);border:1px solid var(--border);margin-bottom:1rem;">
            <h4 style="color:var(--accent);margin-bottom:1rem;">🎯 Цілі</h4>
            <p><strong>Короткострокова:</strong> ${goals.short?.description?.uk ? '✅' : '❌'}</p>
            <p><strong>Довгострокова:</strong> ${goals.long?.description?.uk ? '✅' : '❌'}</p>
        </div>
        <div style="background:var(--bg-card);padding:2rem;border-radius:var(--border-radius);border:1px solid var(--border);">
            <h4 style="color:var(--accent);margin-bottom:1rem;">📧 Контакти</h4>
            <p><strong>Email:</strong> ${contacts.email || '—'}</p>
            <p><strong>Telegram:</strong> ${contacts.telegram || '—'}</p>
            <p><strong>GitHub:</strong> ${contacts.github || '—'}</p>
            <p><strong>LinkedIn:</strong> ${contacts.linkedin || '—'}</p>
        </div>`;
}

// ============================================================================
// ЕКСПОРТ
// ============================================================================

function updateProjectsExport() {
    document.getElementById('projects-json-output').textContent = JSON.stringify(projectsData, null, 2);
}

function updateAboutExport() {
    document.getElementById('about-json-output').textContent = JSON.stringify(aboutData, null, 2);
}

function copyProjectsJSON() {
    navigator.clipboard.writeText(JSON.stringify(projectsData, null, 2))
        .then(() => showAlert('success', '✅ Скопійовано!'));
}

function copyAboutJSON() {
    navigator.clipboard.writeText(JSON.stringify(aboutData, null, 2))
        .then(() => showAlert('success', '✅ Скопійовано!'));
}

function downloadProjectsJSON() {
    const blob = new Blob([JSON.stringify(projectsData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'projects.json';
    link.click();
    showAlert('success', '✅ Файл завантажено!');
}

function downloadAboutJSON() {
    const blob = new Blob([JSON.stringify(aboutData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'about.json';
    link.click();
    showAlert('success', '✅ Файл завантажено!');
}

// ============================================================================
// ABOUT — ФОРМА РЕДАГУВАННЯ
// ============================================================================

function renderAboutEditForm() {
    const { profile = {}, skills = {}, education = [], goals = {}, contacts = {} } = aboutData;

    document.getElementById('about-name-uk').value = profile.name?.uk || '';
    document.getElementById('about-name-en').value = profile.name?.en || '';
    document.getElementById('about-age').value = profile.age || '';
    document.getElementById('about-bio-uk').value = (profile.bio?.uk || []).join('\n');
    document.getElementById('about-bio-en').value = (profile.bio?.en || []).join('\n');

    document.getElementById('about-email').value = contacts.email || '';
    document.getElementById('about-telegram').value = contacts.telegram || '';
    document.getElementById('about-github').value = contacts.github || '';
    document.getElementById('about-linkedin').value = contacts.linkedin || '';

    document.getElementById('about-skills-languages').value = (skills.languages?.items || []).join('\n');
    document.getElementById('about-skills-tools').value = (skills.tools?.items || []).join('\n');
    document.getElementById('about-skills-principles').value = (skills.principles?.items || []).join('\n');
    document.getElementById('about-skills-other').value = (skills.other?.items || []).join('\n');

    document.getElementById('about-goal-short-uk').value = goals.short?.description?.uk || '';
    document.getElementById('about-goal-short-en').value = goals.short?.description?.en || '';
    document.getElementById('about-goal-long-uk').value = goals.long?.description?.uk || '';
    document.getElementById('about-goal-long-en').value = goals.long?.description?.en || '';

    renderEducationList(education);
}

function renderEducationList(education) {
    const container = document.getElementById('about-education-list');
    if (!container) return;
    if (education.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:1rem;">Немає записів — натисни "Додати запис"</p>';
        return;
    }
    container.innerHTML = education.map((item, i) => `
        <div class="edu-entry" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--border-radius-sm);padding:1.2rem;margin-bottom:0.8rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
                <strong style="color:var(--accent);">Запис ${i + 1}</strong>
                <button class="btn btn-danger" style="padding:0.3rem 0.7rem;font-size:0.8rem;" onclick="removeEducationEntry(${i})">✕ Видалити</button>
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Рік / Діапазон</label>
                    <input type="text" id="edu-year-${i}" value="${item.year || ''}" placeholder="2024">
                </div>
                <div class="form-group full-width">
                    <label>Назва (UA)</label>
                    <input type="text" id="edu-title-uk-${i}" value="${(item.title?.uk || '').replace(/"/g, '&quot;')}" placeholder="Назва UA">
                </div>
                <div class="form-group full-width">
                    <label>Назва (EN)</label>
                    <input type="text" id="edu-title-en-${i}" value="${(item.title?.en || '').replace(/"/g, '&quot;')}" placeholder="Назва EN">
                </div>
                <div class="form-group full-width">
                    <label>Опис (UA)</label>
                    <textarea id="edu-desc-uk-${i}" placeholder="Опис UA">${item.description?.uk || ''}</textarea>
                </div>
                <div class="form-group full-width">
                    <label>Опис (EN)</label>
                    <textarea id="edu-desc-en-${i}" placeholder="Опис EN">${item.description?.en || ''}</textarea>
                </div>
            </div>
        </div>
    `).join('');
}

function addEducationEntry() {
    if (!aboutData.education) aboutData.education = [];
    aboutData.education.push({ year: '', icon: 'book', title: { uk: '', en: '' }, description: { uk: '', en: '' } });
    renderEducationList(aboutData.education);
}

function removeEducationEntry(index) {
    // Зберегти поточні введені значення перед видаленням
    _syncEducationFromForm();
    aboutData.education.splice(index, 1);
    renderEducationList(aboutData.education);
}

function _syncEducationFromForm() {
    const count = document.querySelectorAll('.edu-entry').length;
    for (let i = 0; i < count; i++) {
        if (!aboutData.education[i]) continue;
        aboutData.education[i].year = document.getElementById(`edu-year-${i}`)?.value || '';
        aboutData.education[i].title = {
            uk: document.getElementById(`edu-title-uk-${i}`)?.value || '',
            en: document.getElementById(`edu-title-en-${i}`)?.value || '',
        };
        aboutData.education[i].description = {
            uk: document.getElementById(`edu-desc-uk-${i}`)?.value || '',
            en: document.getElementById(`edu-desc-en-${i}`)?.value || '',
        };
    }
}

async function saveAboutData() {
    const parseLines = raw => raw.split('\n').map(s => s.trim()).filter(Boolean);

    const eduCount = document.querySelectorAll('.edu-entry').length;
    const education = [];
    for (let i = 0; i < eduCount; i++) {
        education.push({
            year: document.getElementById(`edu-year-${i}`)?.value || '',
            icon: aboutData.education?.[i]?.icon || 'book',
            title: {
                uk: document.getElementById(`edu-title-uk-${i}`)?.value || '',
                en: document.getElementById(`edu-title-en-${i}`)?.value || '',
                pl: aboutData.education?.[i]?.title?.pl || '',
                de: aboutData.education?.[i]?.title?.de || '',
            },
            description: {
                uk: document.getElementById(`edu-desc-uk-${i}`)?.value || '',
                en: document.getElementById(`edu-desc-en-${i}`)?.value || '',
                pl: aboutData.education?.[i]?.description?.pl || '',
                de: aboutData.education?.[i]?.description?.de || '',
            }
        });
    }

    const nameUk = document.getElementById('about-name-uk').value;
    const nameEn = document.getElementById('about-name-en').value;

    aboutData = {
        ...aboutData,
        profile: {
            ...aboutData.profile,
            name: {
                uk: nameUk,
                en: nameEn,
                pl: aboutData.profile?.name?.pl || nameEn,
                de: aboutData.profile?.name?.de || nameEn,
            },
            age: parseInt(document.getElementById('about-age').value) || aboutData.profile?.age,
            bio: {
                uk: document.getElementById('about-bio-uk').value.split('\n').filter(s => s.trim()),
                en: document.getElementById('about-bio-en').value.split('\n').filter(s => s.trim()),
                pl: aboutData.profile?.bio?.pl || [],
                de: aboutData.profile?.bio?.de || [],
            }
        },
        contacts: {
            email:    document.getElementById('about-email').value,
            telegram: document.getElementById('about-telegram').value,
            github:   document.getElementById('about-github').value,
            linkedin: document.getElementById('about-linkedin').value,
        },
        skills: {
            languages:  { ...aboutData.skills?.languages,  items: parseLines(document.getElementById('about-skills-languages').value) },
            tools:      { ...aboutData.skills?.tools,      items: parseLines(document.getElementById('about-skills-tools').value) },
            principles: { ...aboutData.skills?.principles, items: parseLines(document.getElementById('about-skills-principles').value) },
            other:      { ...aboutData.skills?.other,      items: parseLines(document.getElementById('about-skills-other').value) },
        },
        goals: {
            short: { ...aboutData.goals?.short, description: {
                uk: document.getElementById('about-goal-short-uk').value,
                en: document.getElementById('about-goal-short-en').value,
                pl: aboutData.goals?.short?.description?.pl || '',
                de: aboutData.goals?.short?.description?.de || '',
            }},
            long: { ...aboutData.goals?.long, description: {
                uk: document.getElementById('about-goal-long-uk').value,
                en: document.getElementById('about-goal-long-en').value,
                pl: aboutData.goals?.long?.description?.pl || '',
                de: aboutData.goals?.long?.description?.de || '',
            }},
        },
        education,
    };

    localStorage.setItem('portfolioAbout', JSON.stringify(aboutData));
    renderAboutPreview();
    updateAboutExport();

    const savedToFile = await trySaveAboutToFile();
    showAlert('success', savedToFile ? '✅ about.json збережено!' : '✅ Збережено в браузері (папка не підключена)');
}

// ============================================================================
// АЛЕРТИ
// ============================================================================

function showAlert(type, message) {
    document.querySelector('.alert-floating')?.remove();
    const el = document.createElement('div');
    el.className = `alert alert-${type} alert-floating`;
    el.textContent = message;
    Object.assign(el.style, { position: 'fixed', top: '2rem', right: '2rem', zIndex: '10000', minWidth: '300px', animation: 'slideDown 0.3s ease' });
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ============================================================================
// РЕДАГУВАННЯ / ДОДАВАННЯ ПРОЄКТУ
// ============================================================================

function addNewProject() {
    editingProjectId = 'new';
    [
        'edit-title-uk','edit-title-en','edit-title-pl','edit-title-de',
        'edit-shortDesc-uk','edit-shortDesc-en','edit-shortDesc-pl','edit-shortDesc-de',
        'edit-desc-uk','edit-desc-en','edit-desc-pl','edit-desc-de',
        'edit-github','edit-download','edit-technologies','edit-videos',
    ].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('edit-status').value = 'inProgress';
    document.getElementById('edit-category').value = 'apps';
    document.getElementById('edit-icon').value = 'app';
    document.getElementById('edit-featured').checked = false;
    document.getElementById('modal-title').textContent = '➕ Новий проєкт';
    initEditState(null);
    document.getElementById('edit-project-modal').classList.add('active');
}

function editProject(id) {
    const project = projectsData.projects.find(p => p.id === id);
    if (!project) return;
    editingProjectId = id;

    document.getElementById('edit-title-uk').value     = project.title?.uk || '';
    document.getElementById('edit-title-en').value     = project.title?.en || '';
    document.getElementById('edit-title-pl').value     = project.title?.pl || '';
    document.getElementById('edit-title-de').value     = project.title?.de || '';
    document.getElementById('edit-status').value       = project.status || 'inProgress';
    document.getElementById('edit-category').value     = project.category || 'apps';
    document.getElementById('edit-featured').checked   = !!project.featured;
    document.getElementById('edit-icon').value         = project.icon || 'app';
    document.getElementById('edit-github').value       = project.github || '';
    document.getElementById('edit-download').value     = project.download || '';

    document.getElementById('edit-shortDesc-uk').value = project.shortDescription?.uk || '';
    document.getElementById('edit-shortDesc-en').value = project.shortDescription?.en || '';
    document.getElementById('edit-shortDesc-pl').value = project.shortDescription?.pl || '';
    document.getElementById('edit-shortDesc-de').value = project.shortDescription?.de || '';

    document.getElementById('edit-desc-uk').value      = project.description?.uk || '';
    document.getElementById('edit-desc-en').value      = project.description?.en || '';
    document.getElementById('edit-desc-pl').value      = project.description?.pl || '';
    document.getElementById('edit-desc-de').value      = project.description?.de || '';

    document.getElementById('edit-technologies').value = (project.technologies || []).join('\n');
    document.getElementById('edit-videos').value       = (project.videos || []).join('\n');

    document.getElementById('modal-title').textContent = '✏️ Редагування проєкту';
    initEditState(project);
    document.getElementById('edit-project-modal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('edit-project-modal').classList.remove('active');
    document.getElementById('modal-title').textContent = '✏️ Редагування проєкту';
    editingProjectId = null;
    // Blob URLs очищає initEditState при наступному відкритті
}

async function saveEditProject() {
    const enTitle = document.getElementById('edit-title-en').value.trim();
    if (!enTitle) { showAlert('error', '❌ Вкажи назву EN'); return; }

    const enShort = document.getElementById('edit-shortDesc-en').value;
    const enDesc  = document.getElementById('edit-desc-en').value;
    const parseLines = raw => raw.split('\n').map(s => s.trim()).filter(Boolean);

    const isNew = editingProjectId === 'new';

    // Копіювати нові файли зображень, якщо є
    const hasNewImages = mainImageState.file || galleryItems.some(i => i.file);
    if (hasNewImages) {
        if (!projectDirHandle) {
            showAlert('error', '❌ Спочатку підключи папку проєкту (кнопка "🔗 Підключити папку")');
            return;
        }
        try {
            if (mainImageState.file) {
                mainImageState.path = await copyImageFile(mainImageState.file, enTitle);
                mainImageState.blobUrl = mainImageState.path;
                mainImageState.file = null;
            }
            for (const item of galleryItems) {
                if (item.file) {
                    item.path = await copyImageFile(item.file, enTitle);
                    item.blobUrl = item.path;
                    item.file = null;
                }
            }
        } catch (e) {
            showAlert('error', '❌ Помилка копіювання зображень: ' + e.message);
            return;
        }
    }

    const fields = {
        featured:  document.getElementById('edit-featured').checked,
        status:    document.getElementById('edit-status').value,
        category:  document.getElementById('edit-category').value,
        icon:      document.getElementById('edit-icon').value,
        github:    document.getElementById('edit-github').value,
        download:  document.getElementById('edit-download').value,
        mainImage: mainImageState.path,
        title: {
            uk: document.getElementById('edit-title-uk').value || enTitle,
            en: enTitle,
            pl: document.getElementById('edit-title-pl').value || enTitle,
            de: document.getElementById('edit-title-de').value || enTitle,
        },
        shortDescription: {
            uk: document.getElementById('edit-shortDesc-uk').value || enShort,
            en: enShort,
            pl: document.getElementById('edit-shortDesc-pl').value || enShort,
            de: document.getElementById('edit-shortDesc-de').value || enShort,
        },
        description: {
            uk: document.getElementById('edit-desc-uk').value || enDesc,
            en: enDesc,
            pl: document.getElementById('edit-desc-pl').value || enDesc,
            de: document.getElementById('edit-desc-de').value || enDesc,
        },
        technologies: parseLines(document.getElementById('edit-technologies').value),
        videos:       parseLines(document.getElementById('edit-videos').value),
        gallery:      galleryItems.map(i => i.path).filter(Boolean),
    };

    if (isNew) {
        projectsData.projects.push({ id: Date.now(), features: [], ...fields });
    } else {
        const index = projectsData.projects.findIndex(p => p.id === editingProjectId);
        if (index === -1) return;
        projectsData.projects[index] = { ...projectsData.projects[index], ...fields };
    }

    localStorage.setItem('portfolioProjects', JSON.stringify(projectsData));
    renderProjectsList();
    updateProjectsExport();

    // Спробувати зберегти прямо у файл
    const savedToFile = await trySaveProjectsToFile();

    closeEditModal();
    if (savedToFile) {
        showAlert('success', isNew ? '✅ Проєкт додано!' : '✅ Збережено!');
    } else {
        showAlert('warning', isNew ? '✅ Проєкт додано (скачай JSON вручну)' : '✅ Збережено в браузері (скачай JSON вручну)');
    }
}

// ============================================================================
// ІНІЦІАЛІЗАЦІЯ
// ============================================================================

window.addEventListener('DOMContentLoaded', async () => {
    if (!window.showDirectoryPicker) {
        const label = document.getElementById('dir-status-label');
        if (label) {
            label.textContent = '⚠️ Авто-збереження недоступне (потрібен Chrome/Edge). Використовуй вкладку "Експорт".';
        }
        return;
    }
    await tryRestoreDirHandle();
});
