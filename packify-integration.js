/* ============================================
   Packify AI SDK Integration — iframe postMessage bridge
   ============================================ */

const STORAGE_KEY = 'packify_context';

// ============ LocalStorage Context ============
function loadDesignContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { currentProjectId: null, projects: [] };
  } catch (e) {
    return { currentProjectId: null, projects: [] };
  }
}

function saveDesignContext(patch) {
  const ctx = loadDesignContext();
  Object.assign(ctx, patch);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  return ctx;
}

function saveProjectToContext(projectId, extra) {
  const ctx = loadDesignContext();
  ctx.currentProjectId = projectId;
  let proj = ctx.projects.find(p => p.id === projectId);
  if (!proj) {
    proj = { id: projectId, createdAt: new Date().toISOString(), generatedImages: [] };
    ctx.projects.push(proj);
  }
  if (extra) Object.assign(proj, extra);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

function addImageToProject(projectId, imageUrl) {
  const ctx = loadDesignContext();
  const proj = ctx.projects.find(p => p.id === projectId);
  if (proj) {
    if (!proj.generatedImages) proj.generatedImages = [];
    if (!proj.generatedImages.includes(imageUrl)) {
      proj.generatedImages.push(imageUrl);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  }
}

// ============ Listen for messages from Packify iframe ============
window.addEventListener('message', (e) => {
  if (!e.data || !e.data.type) return;

  if (e.data.type === 'packify_project_created') {
    console.log('Packify project created:', e.data.projectId);
    window.packifyProjectId = e.data.projectId;
    saveProjectToContext(e.data.projectId);
  }

  if (e.data.type === 'packify_images') {
    console.log('Packify images received:', e.data.images);
    if (e.data.images && e.data.images.length > 0) {
      e.data.images.forEach(imageUrl => {
        addPackifyImageToCanvas(imageUrl);
        if (e.data.projectId) {
          addImageToProject(e.data.projectId, imageUrl);
        }
      });
    }
  }

  // User clicked an image in the Packify chat — add to canvas
  if (e.data.type === 'packify_image_clicked') {
    console.log('Image clicked in chat:', e.data.imageUrl);
    addPackifyImageToCanvas(e.data.imageUrl);
  }
});

// ============ Send commands to Packify iframe ============
function sendToPackifyFrame(msg) {
  const frame = document.getElementById('packifyFrame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(msg, '*');
  }
}

function openPackifyDesign() {
  sendToPackifyFrame({ type: 'packify_new_project' });
}

function reopenPackifyDesign(projectId) {
  sendToPackifyFrame({ type: 'packify_reopen', projectId });
}

// ============ Add generated image to canvas ============
function addPackifyImageToCanvas(imageUrl) {
  // Uses addToCanvas from app.js which handles smart placement + auto-pan
  if (typeof addToCanvas === 'function') {
    addToCanvas(imageUrl);
  }
}
