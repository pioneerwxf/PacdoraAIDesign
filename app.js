/* ============================================
   Pacdora AI Design - Application Logic
   ============================================ */

// ============ Theme Toggle ============
function initTheme() {
  const saved = localStorage.getItem('pacdora-theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('pacdora-theme', next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const lightIcon = document.getElementById('themeIconLight');
  const darkIcon = document.getElementById('themeIconDark');
  if (lightIcon && darkIcon) {
    if (theme === 'dark') {
      lightIcon.style.display = 'none';
      darkIcon.style.display = 'flex';
    } else {
      lightIcon.style.display = 'flex';
      darkIcon.style.display = 'none';
    }
  }
}

// Initialize theme on load
initTheme();

// ============ State ============
let zoomScale = 1;
const ZOOM_STEP = 0.05;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
let isPanning = false;
let panStart = { x: 0, y: 0 };
// Transform-based panning (allows infinite movement in all directions)
let panX = 0;  // translation in screen pixels
let panY = 0;
// Track mouse position over canvas for paste
let mouseCanvasX = 0, mouseCanvasY = 0;
// Clipboard for card copy/paste
let clipboardCard = null;

// ============ DOM References ============
const canvasViewport = document.getElementById('canvasViewport');
const canvasContent = document.getElementById('canvasContent');
const zoomLevelEl = document.getElementById('zoomLevel');
// chatMessages and chatInput removed — Packify handles the UI
const projectSelector = document.getElementById('projectSelector');

// ============ Zoom Controls ============

// Apply current zoom & pan to DOM
function applyZoom() {
  canvasContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  zoomLevelEl.textContent = Math.round(zoomScale * 100) + '%';
  updateCounterScale();
}

// Counter-scale UI elements so they stay constant size regardless of zoom.
// Toolbar and label are inside card-body (position:relative).
// We position them above the image with fixed pixel gaps in screen space.
function updateCounterScale() {
  const inv = 1 / zoomScale;

  document.querySelectorAll('.card-body').forEach(body => {
    const toolbar = body.querySelector('.card-toolbar');
    const label = body.querySelector('.card-label');

    // Fixed screen-space gaps (px)
    const LABEL_GAP = 4;    // gap between label bottom and image top
    const TOOLBAR_GAP = 2;  // gap between toolbar bottom and label top
    const LABEL_H = 18;     // approximate label height in screen px
    const TOOLBAR_H = 36;   // approximate toolbar height in screen px

    if (label) {
      // Position label above image: convert screen px gap to canvas px
      const labelBottom = (LABEL_GAP) * inv;
      label.style.transform = `scale(${inv})`;
      label.style.bottom = `calc(100% + ${labelBottom}px)`;
    }

    if (toolbar) {
      // Position toolbar above label
      const toolbarBottom = (LABEL_GAP + LABEL_H + TOOLBAR_GAP) * inv;
      toolbar.style.transform = `scale(${inv})`;
      toolbar.style.bottom = `calc(100% + ${toolbarBottom}px)`;
    }
  });

  // Logo edit area below card
  document.querySelectorAll('.logo-edit-area').forEach(el => {
    el.style.transform = `scale(${inv})`;
    el.style.transformOrigin = 'left top';
  });

  // Counter-scale mode toggles
  document.querySelectorAll('.card-mode-toggle').forEach(el => {
    el.style.transform = `scale(${inv})`;
  });

  // Counter-scale modify-history-bar: match card body screen width, text stays readable size
  // The bar has scale(inv) applied, so its CSS px = its screen px (the two scales cancel out).
  // Card body screen width = bodyW * zoomScale, so set bar CSS width to the same value.
  document.querySelectorAll('.modify-history-bar').forEach(bar => {
    const card = bar.closest('.design-card');
    if (!card) return;
    const body = card.querySelector('.card-body');
    if (!body) return;
    const bodyH = parseFloat(body.style.height) || body.offsetHeight;
    const bodyW = parseFloat(body.style.width) || body.offsetWidth;
    const GAP = 2; // screen-px gap between card bottom edge and bar top
    bar.style.top = (bodyH + GAP * inv) + 'px';
    // Width: bodyW (canvas px) × zoomScale = screen px = CSS px after counter-scale
    bar.style.width = (bodyW * zoomScale) + 'px';
    bar.style.transform = `scale(${inv})`;
  });

  // Keep card borders at 1px screen size regardless of zoom
  document.querySelectorAll('.card-body').forEach(el => {
    el.style.borderWidth = (1 * inv) + 'px';
  });

  // Keep resize handles at constant screen size
  document.querySelectorAll('.resize-handle').forEach(el => {
    const size = 8 * inv;
    const offset = -Math.round(size / 2);
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.borderWidth = (1.5 * inv) + 'px';
    // Adjust position offsets
    if (el.classList.contains('tl') || el.classList.contains('tr')) el.style.top = offset + 'px';
    if (el.classList.contains('bl') || el.classList.contains('br')) el.style.bottom = offset + 'px';
    if (el.classList.contains('tl') || el.classList.contains('bl') || el.classList.contains('ml')) el.style.left = offset + 'px';
    if (el.classList.contains('tr') || el.classList.contains('br') || el.classList.contains('mr')) el.style.right = offset + 'px';
    if (el.classList.contains('tm') || el.classList.contains('bm')) { el.style.left = '50%'; el.style.transform = `translateX(-50%)`; }
    if (el.classList.contains('ml') || el.classList.contains('mr')) { el.style.top = '50%'; el.style.transform = `translateY(-50%)`; }
    if (el.classList.contains('tm')) el.style.top = offset + 'px';
    if (el.classList.contains('bm')) el.style.bottom = offset + 'px';
  });
}

// Core: zoom to a specific scale, keeping viewportX/viewportY pinned in place
function zoomTo(newScale, viewportX, viewportY) {
  newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
  if (newScale === zoomScale) return;

  const oldScale = zoomScale;

  // Content coordinate under the cursor before zoom
  // viewportX/Y is relative to the viewport element
  // panX/Y is the current translation, so the content origin is at (panX, panY)
  // The content coord under cursor: (viewportX - panX) / oldScale
  const contentX = (viewportX - panX) / oldScale;
  const contentY = (viewportY - panY) / oldScale;

  zoomScale = newScale;

  // Adjust pan so the same content point stays under the cursor
  panX = viewportX - contentX * zoomScale;
  panY = viewportY - contentY * zoomScale;

  applyZoom();
}

// Button zoom: zoom toward viewport center
function zoomIn() {
  const r = canvasViewport.getBoundingClientRect();
  zoomTo(zoomScale * 1.15, r.width / 2, r.height / 2);
}

function zoomOut() {
  const r = canvasViewport.getBoundingClientRect();
  zoomTo(zoomScale / 1.15, r.width / 2, r.height / 2);
}

// Wheel: Ctrl/Cmd + wheel = zoom (cursor-anchored), plain wheel = scroll/pan canvas
canvasViewport.addEventListener('wheel', (e) => {
  e.preventDefault();

  if (e.ctrlKey || e.metaKey) {
    // Zoom: multiplicative, cursor-anchored
    const factor = Math.pow(1.006, -e.deltaY);
    const rect = canvasViewport.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const viewportY = e.clientY - rect.top;
    zoomTo(zoomScale * factor, viewportX, viewportY);
  } else {
    // Pan: trackpad two-finger swipe or mouse wheel scroll
    panX -= e.deltaX;
    panY -= e.deltaY;
    applyZoom();
  }
}, { passive: false });

// ============ Canvas Panning (transform-based, infinite in all directions) ============
let panStartX = 0, panStartY = 0, panXStart = 0, panYStart = 0;

canvasViewport.addEventListener('mousedown', (e) => {
  // Pan with middle mouse button OR clicking on empty canvas background
  if (e.button === 1 || (e.target === canvasContent || e.target === canvasViewport)) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panXStart = panX;
    panYStart = panY;
    canvasViewport.style.cursor = 'grabbing';
    e.preventDefault();
  }
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    panX = panXStart + (e.clientX - panStartX);
    panY = panYStart + (e.clientY - panStartY);
    applyZoom();
  }
});

window.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    canvasViewport.style.cursor = 'grab';
  }
});

// ============ Card Selection ============
function selectCard(card) {
  const prevSelected = document.querySelector('.design-card.selected');
  document.querySelectorAll('.design-card.selected').forEach(c => c.classList.remove('selected'));
  if (card) {
    card.classList.add('selected');
    canvasViewport.focus({ preventScroll: true });
  }
  // Auto-close floating panels when selecting a different card or deselecting
  if (card !== prevSelected) {
    closeAllFloatingPanels();
  }
  // Send selected card's image to chat panel (skip mockup/3D cards)
  syncSelectedCardToChat(card);
}

// Click on card-body to select, click elsewhere to deselect
canvasViewport.addEventListener('click', (e) => {
  const cardBody = e.target.closest('.card-body');
  if (cardBody) {
    // If user clicked directly on the mockup iframe area, don't toggle selection
    // (iframe eats clicks, so this only fires on the border/padding area)
    const card = cardBody.closest('.design-card');
    if (card.classList.contains('selected') && cardBody.querySelector('.mockup-iframe')) {
      // Already selected mockup — keep selected, don't deselect
      return;
    }
    selectCard(card);
    applyZoom(); // refresh counter-scale for newly visible toolbar
    return;
  }
  // Click on canvas background deselects
  selectCard(null);
});

// ============ Project Selector Dropdown ============
projectSelector.addEventListener('click', (e) => {
  e.stopPropagation();
  projectSelector.classList.toggle('open');
});

document.addEventListener('click', () => {
  projectSelector.classList.remove('open');
});

async function newProject() {
  // Clear canvas and start fresh
  const cards = canvasContent.querySelectorAll('.design-card');
  const hints = canvasContent.querySelectorAll('.demo-project-hint');
  cards.forEach(c => c.remove());
  hints.forEach(h => h.remove());

  // Close all floating panels and progress disk
  closeAllFloatingPanels();
  removeProgressDisk();
  clearChatRefImage();

  // Reset pan/zoom
  panX = 0;
  panY = 0;
  zoomScale = 1;
  applyZoom();

  // Create project on server to get a persistent ID
  let projectId;
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Project' })
    });
    const project = await res.json();
    projectId = project.id;
  } catch (e) {
    // Fallback to local ID if server unreachable
    projectId = 'proj-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
  }

  window.history.pushState({ projectId }, '', '?id=' + projectId);
  document.querySelector('.project-name').textContent = 'New Project';
  document.querySelector('.project-name').dataset.projectId = projectId;
  currentProjectId = projectId;
  console.log('New project created:', projectId);

  // Reset text state cache
  cardTextState.clear();
  pinCache.clear();
}

function deleteProject() {
  if (confirm('Delete this project?')) {
    newProject();
    document.querySelector('.project-name').textContent = 'Untitled';
  }
}

// ============ Chat Panel Toggle ============
function toggleChatPanel() {
  const panel = document.getElementById('chatPanel');
  const toggle = document.getElementById('floatingChatToggle');
  panel.classList.toggle('collapsed');
  const isCollapsed = panel.classList.contains('collapsed');
  toggle.classList.toggle('visible', isCollapsed);
}

// ============ Packify-integrated Chat ============
function newPackifyProject() {
  openPackifyDesign();
  saveDesignContext({ lastAction: 'new_project' });
}

function newChat() { newPackifyProject(); }
function sendMessage() {}
function autoResize() {}

// chatInput keydown removed — Packify handles input

// ============ Canvas Card Actions ============
// ============ Smart placement: find empty spot on canvas ============
function findEmptySpot(newW, newH) {
  const GAP = 30;
  const PADDING = 60;
  const TOP_PADDING = 120; // leave room for toolbar above cards

  // Collect bounding boxes of all existing cards
  const cards = document.querySelectorAll('.design-card');
  const boxes = [];
  cards.forEach(card => {
    const body = card.querySelector('.card-body');
    if (!body) return;
    const x = parseFloat(card.style.left) || 0;
    const y = parseFloat(card.style.top) || 0;
    const w = body.offsetWidth || 300;
    const h = body.offsetHeight || 380;
    boxes.push({ x, y, w, h });
  });

  if (boxes.length === 0) {
    return { x: PADDING, y: TOP_PADDING };
  }

  function overlaps(px, py, pw, ph) {
    for (const b of boxes) {
      if (px < b.x + b.w + GAP && px + pw + GAP > b.x &&
          py < b.y + b.h + GAP && py + ph + GAP > b.y) {
        return true;
      }
    }
    return false;
  }

  // Determine the visible canvas area (in canvas coordinates)
  const vpRect = canvasViewport.getBoundingClientRect();
  const visibleW = vpRect.width / zoomScale;
  const visibleH = vpRect.height / zoomScale;
  const viewLeft = -panX / zoomScale;
  const viewTop = -panY / zoomScale;

  // Scan grid positions within the visible area first, then expand outward
  // Use a step size for efficiency
  const stepX = newW + GAP;
  const stepY = newH + GAP;

  // Collect candidate positions: adjacent to existing cards + grid scan
  const candidates = [];

  // Adjacent positions: right of, below, and left of each card
  for (const b of boxes) {
    candidates.push({ x: b.x + b.w + GAP, y: b.y });           // right
    candidates.push({ x: b.x, y: b.y + b.h + GAP + 60 });      // below (with toolbar space)
    candidates.push({ x: b.x - newW - GAP, y: b.y });           // left
  }

  // Grid scan across visible area
  const scanStartX = Math.max(PADDING, Math.floor(viewLeft / stepX) * stepX);
  const scanStartY = Math.max(TOP_PADDING, Math.floor(viewTop / stepY) * stepY);
  for (let y = scanStartY; y < viewTop + visibleH; y += stepY) {
    for (let x = scanStartX; x < viewLeft + visibleW; x += stepX) {
      candidates.push({ x, y });
    }
  }

  // Sort candidates: prefer positions within current viewport, closer to top-left
  candidates.sort((a, b) => {
    const aVisible = (a.x >= viewLeft && a.x + newW <= viewLeft + visibleW &&
                      a.y >= viewTop && a.y + newH <= viewTop + visibleH) ? 0 : 1;
    const bVisible = (b.x >= viewLeft && b.x + newW <= viewLeft + visibleW &&
                      b.y >= viewTop && b.y + newH <= viewTop + visibleH) ? 0 : 1;
    if (aVisible !== bVisible) return aVisible - bVisible;
    // Within same visibility, prefer top-left
    return (a.y + a.x * 0.1) - (b.y + b.x * 0.1);
  });

  // Find first non-overlapping candidate
  for (const c of candidates) {
    if (c.x < 0 || c.y < TOP_PADDING - 60) continue;
    if (!overlaps(c.x, c.y, newW, newH)) {
      return c;
    }
  }

  // Fallback: below everything
  let maxBottom = 0;
  boxes.forEach(b => { maxBottom = Math.max(maxBottom, b.y + b.h); });
  return { x: PADDING, y: maxBottom + GAP + 60 };
}

// Pan canvas to make a position visible in the viewport
function panToReveal(cx, cy) {
  const viewport = canvasViewport.getBoundingClientRect();
  const margin = 80;

  // Convert canvas coords to screen coords
  const screenX = cx * zoomScale + panX;
  const screenY = cy * zoomScale + panY;

  let needPan = false;
  let targetPanX = panX;
  let targetPanY = panY;

  if (screenX < margin) {
    targetPanX = panX + (margin - screenX);
    needPan = true;
  } else if (screenX > viewport.width - margin) {
    targetPanX = panX - (screenX - viewport.width + margin);
    needPan = true;
  }

  if (screenY < margin) {
    targetPanY = panY + (margin - screenY);
    needPan = true;
  } else if (screenY > viewport.height - margin) {
    targetPanY = panY - (screenY - viewport.height + margin);
    needPan = true;
  }

  if (needPan) {
    panX = targetPanX;
    panY = targetPanY;
    applyZoom();
  }
}

function addToCanvas(imageUrl) {
  const NEW_CARD_W = 300;
  const NEW_CARD_H = 380;
  const spot = findEmptySpot(NEW_CARD_W, NEW_CARD_H);

  const card = document.createElement('div');
  card.className = 'design-card';
  card.style.left = spot.x + 'px';
  card.style.top = spot.y + 'px';
  card.setAttribute('data-type', 'creation');

  card.innerHTML = `
    <div class="card-body creation-card">
      <div class="card-toolbar">
        <div class="card-toolbar-icon">
          <i class="fi fi-rr-bulb" style="color:#7C3AED;font-size:12px;"></i>
        </div>
        <span class="card-toolbar-link" onclick="event.stopPropagation(); generateDielineFromCreation(this.closest('.design-card'))">2D Dieline</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation();">3D mockup</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation(); editText(this)">Edit text</span>
        <span class="card-toolbar-sep">|</span>
        <button class="card-download-btn" onclick="event.stopPropagation();">
          <i class="fi fi-rr-download" style="font-size:12px;color:#333;"></i>
        </button>
      </div>
      <div class="card-label creation-label"># 2D Creation</div>
      <div class="card-mode-toggle" onclick="event.stopPropagation();">
        <span class="mode-btn active" onclick="switchCardMode(this, '2d')">2D</span>
        <span class="mode-sep">|</span>
        <span class="mode-btn" onclick="switchCardMode(this, '3d')">3D</span>
      </div>
      <img src="${imageUrl}" alt="Design" class="card-image creation-image" crossorigin="anonymous">
      <div class="resize-handle tl"></div><div class="resize-handle tr"></div><div class="resize-handle bl"></div><div class="resize-handle br"></div><div class="resize-handle tm"></div><div class="resize-handle bm"></div><div class="resize-handle ml"></div><div class="resize-handle mr"></div>
    </div>
  `;

  // Store base64 immediately for data URL images (avoids canvas re-encode on edit)
  if (imageUrl && imageUrl.startsWith('data:image')) {
    const b64 = imageUrl.split(',')[1];
    if (b64) card.dataset.storedBase64 = b64;
  }

  canvasContent.appendChild(card);
  applyZoom();

  // Pan canvas to reveal the new card
  panToReveal(spot.x + NEW_CARD_W / 2, spot.y + NEW_CARD_H / 2);
}

// Pin placement is now handled by the pin-mode click handler below

// ============ AI: Generate 2D Dieline from 2D Creation ============

function getCardImageAsBase64(card) {
  const img = card.querySelector('.card-image');
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

function getCardImageUrl(card) {
  const img = card.querySelector('.card-image');
  return img ? img.src : null;
}

function createLoadingDielineCard(spot, width, height, opts) {
  const cardType = (opts && opts.type) || 'dieline';
  const labelText = (opts && opts.label) || '# 2D Dieline';
  const labelClass = (opts && opts.labelClass) || 'card-label';
  const bodyClass = cardType === 'creation' ? 'creation-card' : cardType === 'mockup' ? 'mockup-card' : 'dieline-card';

  const card = document.createElement('div');
  card.className = 'design-card';
  card.id = 'card-generating-' + Date.now();
  card.style.left = spot.x + 'px';
  card.style.top = spot.y + 'px';
  card.setAttribute('data-type', cardType);

  card.innerHTML = `
    <div class="card-body ${bodyClass}" style="width:${width}px;">
      <div class="${labelClass}">${labelText}</div>
      <div class="dieline-generating" style="height:${height}px;">
        <span class="generating-label">Generating</span>
      </div>
    </div>
  `;

  canvasContent.appendChild(card);
  applyZoom();
  return card;
}

function replaceDielineLoadingWithImage(loadingCard, imageUrl) {
  const body = loadingCard.querySelector('.card-body');
  body.innerHTML = `
    <div class="card-toolbar">
      <div class="card-toolbar-icon">
        <i class="fi fi-rr-bulb" style="color:#7C3AED;font-size:12px;"></i>
      </div>
      <span class="card-toolbar-link" onclick="event.stopPropagation(); editText(this)">Edit Text</span>
      <span class="card-toolbar-sep">|</span>
      <span class="card-toolbar-link" onclick="event.stopPropagation(); editElements(this)">Edit Elements</span>
      <span class="card-toolbar-sep">|</span>
      <span class="card-toolbar-link" onclick="event.stopPropagation(); showMockup('dieline')">Mockup</span>
      <span class="card-toolbar-sep">|</span>
      <span class="card-toolbar-link card-toolbar-highlight" onclick="event.stopPropagation(); separateLayers(this)">
        <i class="fi fi-rr-layers" style="font-size:11px;"></i> Separate Layers
      </span>
      <span class="card-toolbar-sep">|</span>
      <button class="card-download-btn" onclick="event.stopPropagation(); downloadCard('dieline')">
        <i class="fi fi-rr-download" style="font-size:12px;color:#333;"></i>
      </button>
    </div>
    <div class="card-label"># 2D Dieline</div>
    <div class="card-mode-toggle" onclick="event.stopPropagation();">
      <span class="mode-btn active" onclick="switchCardMode(this, '2d')">2D</span>
      <span class="mode-sep">|</span>
      <span class="mode-btn" onclick="switchCardMode(this, '3d')">3D</span>
    </div>
    <img src="${imageUrl}" alt="2D Dieline" class="card-image" crossorigin="anonymous">
    <div class="resize-handle tl"></div><div class="resize-handle tr"></div>
    <div class="resize-handle bl"></div><div class="resize-handle br"></div>
    <div class="resize-handle tm"></div><div class="resize-handle bm"></div>
    <div class="resize-handle ml"></div><div class="resize-handle mr"></div>
  `;
  loadingCard.id = 'card-dieline-' + Date.now();
  applyZoom();
}

async function generateDielineFromCreation(sourceCard) {
  if (!sourceCard) {
    // Try to find the selected card or the first creation card
    sourceCard = document.querySelector('.design-card.selected[data-type="creation"]')
      || document.querySelector('.design-card[data-type="creation"]');
  }
  if (!sourceCard) {
    alert('No 2D Creation card found to generate dieline from.');
    return;
  }

  const CARD_W = 500;
  const CARD_H = 500;
  const spot = findEmptySpot(CARD_W, CARD_H);

  // Create loading card with shimmer animation
  const loadingCard = createLoadingDielineCard(spot, CARD_W, CARD_H);
  panToReveal(spot.x + CARD_W / 2, spot.y + CARD_H / 2);

  try {
    // Get image from source card
    let payload = {};
    const imgUrl = getCardImageUrl(sourceCard);

    // Try base64 first (works for same-origin images)
    try {
      const base64 = getCardImageAsBase64(sourceCard);
      if (base64) {
        payload = { imageBase64: base64 };
      } else {
        payload = { imageUrl: imgUrl };
      }
    } catch (e) {
      // Cross-origin: fall back to URL
      payload = { imageUrl: imgUrl };
    }

    const res = await fetch('/api/generate-dieline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to generate dieline');
    }

    if (data.type === 'image' && data.imageUrl) {
      replaceDielineLoadingWithImage(loadingCard, data.imageUrl);
    } else {
      // No image generated - show error state then remove
      alert(data.error || 'AI could not generate an image. Please try again.');
      loadingCard.remove();
    }
  } catch (err) {
    console.error('Generate dieline error:', err);
    alert('Error generating dieline: ' + err.message);
    loadingCard.remove();
  }
}

// Keep legacy function for backwards compatibility
function generateDieline(el) {
  generateDielineFromCreation(null);
}

function generate3DMockup(el) {
  addSystemMessage('Finding the best matching 3D mockup from Pacdora library...');
  setTimeout(() => {
    const card = document.createElement('div');
    card.className = 'design-card';
    card.style.left = '680px';
    card.style.top = '520px';
    card.setAttribute('data-type', 'mockup');

    card.innerHTML = `
      <div class="card-body mockup-card" ondblclick="openMockupViewer()">
        <div class="card-toolbar">
          <span class="card-toolbar-link">Edit Mockup</span>
          <span class="card-toolbar-sep">|</span>
          <span class="card-toolbar-link">Change model</span>
          <span class="card-toolbar-sep">|</span>
          <span class="card-toolbar-link">Export Dieline</span>
        </div>
        <div class="card-label mockup-label"># 3D mockup</div>
        <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=500&fit=crop" alt="3D Mockup" class="card-image mockup-image">
        <div class="resize-handle tl"></div><div class="resize-handle tr"></div><div class="resize-handle bl"></div><div class="resize-handle br"></div><div class="resize-handle tm"></div><div class="resize-handle bm"></div><div class="resize-handle ml"></div><div class="resize-handle mr"></div>
      </div>
    `;

    canvasContent.appendChild(card);
    addSystemMessage('Your 3D Mockup is ready! Double-click to open the 3D viewer.');
  }, 2500);
}

// ============ Dieline Editor Modal ============
function openDielineEditor() {
  document.getElementById('dielineEditorModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeDielineEditor() {
  document.getElementById('dielineEditorModal').classList.remove('active');
  document.body.style.overflow = '';
}

function saveDielineEdit() {
  closeDielineEditor();
  addSystemMessage('Dieline design saved and updated on canvas.');
}

// ============ 3D Mockup Viewer Modal ============
function openMockupViewer() {
  document.getElementById('mockupViewerModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMockupViewer() {
  document.getElementById('mockupViewerModal').classList.remove('active');
  document.body.style.overflow = '';
}

function saveMockupEdit() {
  closeMockupViewer();
  addSystemMessage('3D Mockup saved and updated on canvas.');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
});

// Close modals on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  }
});

// ============ Sidebar Tab Switching ============
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    tab.parentElement.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

document.querySelectorAll('.mockup-sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    tab.parentElement.querySelectorAll('.mockup-sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// ============ Utility ============
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function canvasUndo() {
  // Placeholder for undo
}

function canvasRedo() {
  // Placeholder for redo
}

let currentToolMode = 'cursor';

function setToolMode(mode) {
  // Dieline and Mockup open iframe modals instead of switching tool mode
  if (mode === 'dieline') {
    openIframeModal('https://www.pacdora.com/dielines', 'Pacdora Dielines');
    return;
  }
  if (mode === 'mockup') {
    openIframeModal('https://www.pacdora.com/mockups', 'Pacdora Mockups');
    return;
  }
  if (mode === 'templates') {
    openIframeModal('https://www.pacdora.com/resource/snack-packaging', 'Choose a design templates and start');
    return;
  }

  currentToolMode = mode;
  document.querySelectorAll('.bottom-tool-btn').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');

  // Pin mode: use custom pin cursor on card images only
  if (mode === 'pin') {
    canvasViewport.classList.add('pin-cursor');
    canvasViewport.style.cursor = 'default';
  } else {
    canvasViewport.classList.remove('pin-cursor');
    canvasViewport.style.cursor = 'grab';
  }
}

function openIframeModal(url, title) {
  // Remove existing iframe modal if any
  const existing = document.getElementById('iframeModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'iframeModal';
  modal.className = 'iframe-modal-overlay';
  modal.innerHTML = `
    <div class="iframe-modal-container">
      <div class="iframe-modal-header">
        <span class="iframe-modal-title">${title}</span>
        <button class="iframe-modal-close" onclick="closeIframeModal()">
          <i class="fi fi-rr-cross-small" style="font-size:16px;"></i>
        </button>
      </div>
      <iframe src="${url}" class="iframe-modal-content" frameborder="0" allowfullscreen></iframe>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeIframeModal() {
  const modal = document.getElementById('iframeModal');
  if (modal) modal.remove();
}

function switchCardMode(btn, mode) {
  const toggle = btn.closest('.card-mode-toggle');
  toggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const card = btn.closest('.design-card');
  const cardBody = card.querySelector('.card-body');
  const currentW = cardBody.offsetWidth;
  const currentH = cardBody.offsetHeight;

  // Save 2D state ONCE before first switch to 3D
  if (mode === '3d' && !card.dataset.saved2d) {
    card.dataset.saved2d = '1';
    card.dataset.origW = currentW;
    card.dataset.origH = currentH;
    card.dataset.origBodyClass = cardBody.className;
    const label = cardBody.querySelector('.card-label');
    if (label) {
      card.dataset.origLabel = label.textContent;
      card.dataset.origLabelClass = label.className;
    }
    // Save image src
    const img = cardBody.querySelector('.card-image');
    if (img) card.dataset.origImgSrc = img.src;
  }

  // Show/hide 3D model window
  const win3d = card.querySelector('.dieline-3d-window');
  const conn3d = card.querySelector('.dieline-3d-connector');
  if (mode === '3d') {
    if (win3d) win3d.classList.add('hidden-3d');
    if (conn3d) conn3d.classList.add('hidden-3d');
  } else {
    if (win3d) win3d.classList.remove('hidden-3d');
    if (conn3d) conn3d.classList.remove('hidden-3d');
  }

  if (mode === '3d') {
    const img = cardBody.querySelector('.card-image');
    if (img) {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.pacdora.com/share?filter_url=psre5mjuiy';
      iframe.className = 'mockup-iframe';
      iframe.frameBorder = '0';
      iframe.allowFullscreen = true;
      img.replaceWith(iframe);

      const label = cardBody.querySelector('.card-label');
      if (label) { label.textContent = '# 3D mockup'; label.className = 'card-label mockup-label'; }
      cardBody.className = 'card-body mockup-card';
      cardBody.style.width = currentW + 'px';
      cardBody.style.height = currentH + 'px';
    }
  } else {
    const iframe = cardBody.querySelector('.mockup-iframe');
    if (iframe) {
      const img = document.createElement('img');
      img.src = card.dataset.origImgSrc || 'images/mother-dairy-vanilla.png';
      img.alt = '2D Image';
      img.className = 'card-image';
      iframe.replaceWith(img);

      // Restore original class (dieline-card or creation-card)
      cardBody.className = card.dataset.origBodyClass || 'card-body dieline-card';

      // Restore original label
      const label = cardBody.querySelector('.card-label');
      if (label && card.dataset.origLabel) {
        label.textContent = card.dataset.origLabel;
        label.className = card.dataset.origLabelClass || 'card-label';
      }

      // Restore original dimensions — image fills width naturally
      const origW = parseInt(card.dataset.origW) || currentW;
      cardBody.style.width = origW + 'px';
      cardBody.style.height = '';  // let image determine height
    }
  }
  applyZoom();
}

function editText(typeOrEl) {
  let card;
  if (typeOrEl instanceof HTMLElement) {
    // Called with a DOM element — find the closest card
    card = typeOrEl.closest('.design-card');
  } else {
    // Called with a type string — find selected card of that type, or first match
    card = document.querySelector(`.design-card[data-type="${typeOrEl}"].selected`)
      || document.querySelector(`.design-card[data-type="${typeOrEl}"]`);
  }
  if (!card) return;
  openEditTextPanel(card);
}

function editElements(elOrType) {
  let card;
  if (elOrType instanceof HTMLElement) {
    card = elOrType.closest('.design-card');
  } else {
    card = document.querySelector(`.design-card[data-type="${elOrType}"].selected`)
      || document.querySelector(`.design-card[data-type="${elOrType}"]`);
  }
  if (!card) return;
  openEditElementsPanel(card);
}

function openEditElementsPanel(card) {
  closeAllFloatingPanels();

  const cardBody = card.querySelector('.card-body');
  const cardRect = cardBody.getBoundingClientRect();

  // Position next to card
  let panelLeft = cardRect.right + 16;
  let panelTop = cardRect.top;
  const panelWidth = 440;
  if (panelLeft + panelWidth > window.innerWidth - 20) {
    panelLeft = cardRect.left - panelWidth - 16;
  }
  panelLeft = Math.max(12, Math.min(panelLeft, window.innerWidth - panelWidth - 12));
  panelTop = Math.max(12, Math.min(panelTop, window.innerHeight - 300));

  const panel = document.createElement('div');
  panel.className = 'edit-text-panel';
  panel.id = 'editElementsPanel';
  panel.style.left = panelLeft + 'px';
  panel.style.top = panelTop + 'px';
  panel.style.width = panelWidth + 'px';
  panel.innerHTML = `
    <div class="edit-text-panel-header" id="editElementsDragHandle">
      <h3 style="font-size:14px;margin:0;">Edit Elements</h3>
      <button class="edit-text-panel-close" onclick="closeEditElementsPanel()">
        <i class="fi fi-rr-cross-small" style="font-size:14px;"></i>
      </button>
    </div>
    <div class="edit-text-panel-body" id="editElementsPanelBody">
      <div class="edit-text-loading">
        Extracting elements from image<span class="loading-dots"><span></span><span></span><span></span></span>
      </div>
    </div>
    <div class="edit-text-panel-footer">
      <button class="edit-text-cancel-btn" onclick="closeEditElementsPanel()">Cancel</button>
      <button class="edit-text-save-btn" onclick="applyElementChanges()">Apply Changes</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Draggable
  initElementsPanelDrag(panel);

  panel._card = card;
  panel.dataset.cardId = card.id || '';

  // Extract elements (simulated)
  extractElementsFromCard(card);
}

// Type-to-emoji mapping for element thumbnails
const ELEMENT_TYPE_ICONS = {
  background: '🎨', logo: '🏷️', text: '📝', illustration: '🖼️', photo: '📷',
  icon: '⭐', pattern: '🔲', barcode: '📊', badge: '✅', decoration: '✨'
};

async function extractElementsFromCard(card) {
  const body = document.getElementById('editElementsPanelBody');
  if (!body) return;

  // Try to get image base64 for AI extraction
  let imageBase64 = null;
  try { imageBase64 = getCardImageAsBase64(card); } catch (e) {}

  let elements = null;

  if (imageBase64) {
    try {
      const res = await fetch('/api/extract-elements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 })
      });
      const data = await res.json();
      if (res.ok && data.elements && data.elements.length > 0) {
        elements = data.elements;
      } else {
        console.warn('Element extraction API error, using fallback:', data.error);
      }
    } catch (err) {
      console.warn('Element extraction failed, using fallback:', err);
    }
  }

  // Fallback demo elements
  if (!elements) {
    elements = [
      { label: 'Background', type: 'background', desc: 'Main background color/pattern', position: 'center' },
      { label: 'Brand Logo', type: 'logo', desc: 'Brand logo mark', position: 'top-center' },
      { label: 'Product Photo', type: 'photo', desc: 'Main product image', position: 'center' },
      { label: 'Splash Graphic', type: 'illustration', desc: 'Milk splash illustration', position: 'center' },
      { label: 'Vanilla Icon', type: 'illustration', desc: 'Vanilla flower & pods', position: 'center-left' },
      { label: 'Chocolate Pieces', type: 'decoration', desc: 'Chocolate chunks decoration', position: 'bottom-right' },
      { label: 'Certification Badge', type: 'badge', desc: 'Quality certification mark', position: 'bottom-left' },
      { label: 'QR Code', type: 'barcode', desc: 'QR code for product info', position: 'bottom-left' },
      { label: 'Barcode', type: 'barcode', desc: 'Product barcode', position: 'bottom-right' },
      { label: 'Social Icons', type: 'icon', desc: 'Facebook & Instagram icons', position: 'bottom-left' },
    ];
  }

  // Check if panel still exists (user might have closed it during API call)
  if (!document.getElementById('editElementsPanelBody')) return;

  renderElementRows(elements);
}

function renderElementRows(elements) {
  const body = document.getElementById('editElementsPanelBody');
  if (!body) return;

  body.innerHTML = elements.map((item, i) => {
    const icon = ELEMENT_TYPE_ICONS[item.type] || '📎';
    return `
      <div class="edit-element-row" data-index="${i}">
        <div class="edit-element-left">
          <div class="edit-element-thumb">${icon}</div>
          <div class="edit-element-info">
            <div class="edit-element-label">${item.label}</div>
            <div class="edit-element-desc">${item.desc}${item.position ? ' · ' + item.position : ''}</div>
          </div>
        </div>
        <div class="edit-element-right">
          <input type="text" class="edit-element-input" placeholder="Describe modification...">
          <button class="edit-element-replace-btn" onclick="replaceElement(this, ${i})" title="Replace with local file">
            <i class="fi fi-rr-refresh" style="font-size:11px;"></i> Replace
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function replaceElement(btn, index) {
  // Create a hidden file input to let user pick a local file
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const row = btn.closest('.edit-element-row');
    const thumb = row.querySelector('.edit-element-thumb');
    const reader = new FileReader();
    reader.onload = (ev) => {
      thumb.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`;
      row.classList.add('element-replaced');
      row.dataset.replacedSrc = ev.target.result;
    };
    reader.readAsDataURL(file);
    fileInput.remove();
  };
  document.body.appendChild(fileInput);
  fileInput.click();
}

function closeEditElementsPanel() {
  const panel = document.getElementById('editElementsPanel');
  if (panel) panel.remove();
}

function applyElementChanges() {
  const panel = document.getElementById('editElementsPanel');
  if (!panel) return;

  const rows = panel.querySelectorAll('.edit-element-row');
  const changes = [];
  rows.forEach(row => {
    const label = row.querySelector('.edit-element-label').textContent;
    const inputVal = row.querySelector('.edit-element-input').value.trim();
    const replacedSrc = row.dataset.replacedSrc || null;
    if (inputVal || replacedSrc) {
      changes.push({ label, description: inputVal, replacedSrc });
    }
  });

  if (changes.length === 0) {
    closeEditElementsPanel();
    return;
  }

  console.log('Element changes:', changes);
  // TODO: call AI to apply element modifications
  closeEditElementsPanel();
}

function initElementsPanelDrag(panel) {
  const handle = panel.querySelector('#editElementsDragHandle');
  let isDragging = false;
  let startX, startY, startLeft, startTop;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.edit-text-panel-close')) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    startLeft = panel.offsetLeft; startTop = panel.offsetTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (startLeft + e.clientX - startX) + 'px';
    panel.style.top = (startTop + e.clientY - startY) + 'px';
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
}

function showMockup(type) {
  // Placeholder
}

function downloadCard(type) {
  // Placeholder
}

// ============ Separate Layers (Dieline) ============
function separateLayers(el) {
  const card = el.closest('.design-card');
  if (!card) return;

  const cardBody = card.querySelector('.card-body');
  const origX = parseFloat(card.style.left) || 0;
  const origY = parseFloat(card.style.top) || 0;
  const origW = cardBody.offsetWidth;
  const origH = cardBody.offsetHeight;
  const origLabel = cardBody.querySelector('.card-label');
  const origLabelClass = origLabel ? origLabel.className : 'card-label';

  // Create loading placeholder card
  const spot = { x: origX + origW + 30, y: origY + 20 };
  const loadingCard = createLoadingDielineCard(spot, origW, origH, {
    type: 'dieline',
    label: '# 2D Artwork-with Layers',
    labelClass: origLabelClass
  });
  const genLabel = loadingCard.querySelector('.generating-label');
  if (genLabel) genLabel.textContent = 'Separating layers...';

  panToReveal(spot.x + origW / 2, spot.y + origH / 2);

  // Create progress disk
  createProgressDisk(loadingCard, 30000); // 30 seconds demo
}

// ============ Progress Disk ============
let progressDiskState = null;

function createProgressDisk(targetCard, durationMs) {
  // Remove existing
  removeProgressDisk();

  const circumference = 2 * Math.PI * 22; // r=22 for the circle
  const disk = document.createElement('div');
  disk.className = 'progress-disk';
  disk.id = 'progressDisk';
  disk.innerHTML = `
    <svg viewBox="0 0 52 52">
      <circle class="progress-disk-circle" cx="26" cy="26" r="22"/>
      <circle class="progress-disk-bar" cx="26" cy="26" r="22"
              stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/>
    </svg>
    <span class="progress-disk-text">0%</span>
  `;
  document.body.appendChild(disk);

  // Task detail panel
  const panel = document.createElement('div');
  panel.className = 'task-detail-panel';
  panel.id = 'taskDetailPanel';
  panel.innerHTML = `
    <div class="task-detail-header">
      <h4>Tasks</h4>
      <button class="task-detail-close" onclick="toggleTaskDetail()">
        <i class="fi fi-rr-cross-small"></i>
      </button>
    </div>
    <div class="task-detail-item" id="taskItem">
      <div class="task-detail-icon running">
        <i class="fi fi-rr-layers"></i>
      </div>
      <div class="task-detail-info">
        <div class="task-detail-name">Separating layers for 2D Dieline</div>
        <div class="task-detail-status" id="taskStatus">Processing... 0%</div>
        <div class="task-detail-progress">
          <div class="task-detail-progress-bar" id="taskProgressBar" style="width:0%"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  disk.onclick = () => toggleTaskDetail();

  // Animate progress over durationMs
  const startTime = Date.now();
  const bar = disk.querySelector('.progress-disk-bar');
  const text = disk.querySelector('.progress-disk-text');
  const taskStatus = panel.querySelector('#taskStatus');
  const taskBar = panel.querySelector('#taskProgressBar');
  const taskIcon = panel.querySelector('.task-detail-icon');
  const taskItem = panel.querySelector('#taskItem');

  progressDiskState = { targetCard, interval: null };

  progressDiskState.interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
    const offset = circumference - (pct / 100) * circumference;

    bar.style.strokeDashoffset = offset;
    text.textContent = pct + '%';
    taskStatus.textContent = pct < 100 ? `Processing... ${pct}%` : 'Completed';
    taskBar.style.width = pct + '%';

    if (pct >= 100) {
      clearInterval(progressDiskState.interval);
      text.textContent = '✓';
      text.style.color = '#4CAF50';
      text.style.fontSize = '16px';
      taskIcon.classList.remove('running');
      taskIcon.classList.add('done');
      taskIcon.innerHTML = '<i class="fi fi-rr-check" style="color:#4CAF50;"></i>';
      taskStatus.textContent = 'Completed — click to view';

      // Replace loading card with result
      finishSeparateLayers(targetCard);

      // Add "View" button to task
      const viewBtn = document.createElement('button');
      viewBtn.className = 'task-detail-action';
      viewBtn.textContent = 'View';
      viewBtn.onclick = () => {
        // Pan to the card
        const x = parseFloat(targetCard.style.left) || 0;
        const y = parseFloat(targetCard.style.top) || 0;
        const w = targetCard.querySelector('.card-body')?.offsetWidth || 400;
        const h = targetCard.querySelector('.card-body')?.offsetHeight || 400;
        panToReveal(x + w / 2, y + h / 2);
        selectCard(targetCard);
        applyZoom();
        removeProgressDisk();
      };
      taskItem.appendChild(viewBtn);

      // Clicking the disk also navigates
      disk.onclick = () => {
        viewBtn.click();
      };
    }
  }, 300);
}

function toggleTaskDetail() {
  const panel = document.getElementById('taskDetailPanel');
  if (panel) panel.classList.toggle('visible');
}

function removeProgressDisk() {
  if (progressDiskState && progressDiskState.interval) {
    clearInterval(progressDiskState.interval);
  }
  progressDiskState = null;
  const disk = document.getElementById('progressDisk');
  const panel = document.getElementById('taskDetailPanel');
  if (disk) disk.remove();
  if (panel) panel.remove();
}

function finishSeparateLayers(loadingCard) {
  // Replace loading state with a finished artwork card (demo: clone original dieline image)
  const sourceCard = document.querySelector('#card-dieline');
  if (!sourceCard) return;

  const sourceBody = sourceCard.querySelector('.card-body');
  const newBody = loadingCard.querySelector('.card-body');
  if (!newBody || !sourceBody) return;

  const cloneBody = sourceBody.cloneNode(true);
  cloneBody.querySelectorAll('.pin-marker, .inline-edit-dialog, .dieline-3d-window, .dieline-3d-connector, .modify-history-bar').forEach(el => el.remove());

  // Update label to indicate layers
  const label = cloneBody.querySelector('.card-label');
  if (label) {
    label.textContent = '# 2D Artwork-with Layers';
  }

  cloneBody.style.width = newBody.style.width;
  cloneBody.style.height = '';
  newBody.replaceWith(cloneBody);

  applyZoom();
}

// ============ Layout Panel (Mockup) ============
function openLayoutPanel(el) {
  closeAllFloatingPanels();

  const card = el.closest('.design-card');
  if (!card) return;
  const cardBody = card.querySelector('.card-body');
  const cardRect = cardBody.getBoundingClientRect();

  // Position panel to the right of the card
  let panelLeft = cardRect.right + 16;
  let panelTop = cardRect.top;
  const panelWidth = 320;
  if (panelLeft + panelWidth > window.innerWidth - 20) {
    panelLeft = cardRect.left - panelWidth - 16;
  }
  panelLeft = Math.max(12, Math.min(panelLeft, window.innerWidth - panelWidth - 12));
  panelTop = Math.max(12, Math.min(panelTop, window.innerHeight - 400));

  const panel = document.createElement('div');
  panel.className = 'layout-panel';
  panel.id = 'layoutPanel';
  panel.style.left = panelLeft + 'px';
  panel.style.top = panelTop + 'px';

  // Demo layout thumbnails
  const layouts = [
    'Single front', 'Single angle', 'Two-pack front', 'Two-pack angle',
    'Mirror pair', 'Three-pack row', 'Group front', 'Group angle',
    'Row display', 'Flat lay', 'Grid array'
  ];

  panel.innerHTML = `
    <div class="layout-panel-header" id="layoutDragHandle">
      <h3>Layout</h3>
      <button class="edit-text-panel-close" onclick="closeLayoutPanel()">
        <i class="fi fi-rr-cross-small" style="font-size:14px;"></i>
      </button>
    </div>
    <div class="layout-panel-body">
      <div class="layout-grid">
        ${layouts.map((name, i) => `
          <div class="layout-grid-item ${i === 0 ? 'active' : ''}" onclick="selectLayout(this, ${i})" title="${name}">
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;text-align:center;padding:8px;">${name}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Make draggable
  initLayoutPanelDrag(panel);
}

function closeLayoutPanel() {
  const panel = document.getElementById('layoutPanel');
  if (panel) panel.remove();
}

function selectLayout(item, index) {
  item.closest('.layout-grid').querySelectorAll('.layout-grid-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  console.log('Layout selected:', index);
  // TODO: apply layout to 3D mockup
}

// ============ Background Panel (Mockup) ============
function openBackgroundPanel(el) {
  closeAllFloatingPanels();

  const card = el.closest('.design-card');
  if (!card) return;
  const cardBody = card.querySelector('.card-body');
  const cardRect = cardBody.getBoundingClientRect();

  let panelLeft = cardRect.right + 16;
  let panelTop = cardRect.top;
  const panelWidth = 320;
  if (panelLeft + panelWidth > window.innerWidth - 20) {
    panelLeft = cardRect.left - panelWidth - 16;
  }
  panelLeft = Math.max(12, Math.min(panelLeft, window.innerWidth - panelWidth - 12));
  panelTop = Math.max(12, Math.min(panelTop, window.innerHeight - 400));

  const backgrounds = [
    { name: 'Clean White Studio', color: '#F8F8F8', desc: 'Minimal white background' },
    { name: 'Gradient Purple', color: 'linear-gradient(135deg, #E8D5F5, #F5E6FF)', desc: 'Soft purple gradient' },
    { name: 'Warm Beige', color: '#F5E6D3', desc: 'Warm natural tone' },
    { name: 'Sky Blue', color: 'linear-gradient(180deg, #D4EDFF, #F0F8FF)', desc: 'Light blue sky' },
    { name: 'Pastel Pink', color: 'linear-gradient(135deg, #FFE4EC, #FFF0F5)', desc: 'Soft pink pastel' },
    { name: 'Nature Green', color: 'linear-gradient(135deg, #D4EDDA, #E8F5E9)', desc: 'Fresh green nature' },
    { name: 'Golden Luxury', color: 'linear-gradient(135deg, #FFF8E1, #F5E6C8)', desc: 'Premium gold tone' },
    { name: 'Dark Elegance', color: 'linear-gradient(135deg, #2D2D2D, #1A1A1A)', desc: 'Dark premium look' },
    { name: 'Marble Texture', color: 'linear-gradient(135deg, #F5F5F5, #E0E0E0, #F0F0F0)', desc: 'Marble surface' },
    { name: 'Sunset Warm', color: 'linear-gradient(135deg, #FFE0B2, #FFCCBC)', desc: 'Warm sunset tones' },
    { name: 'Ocean Breeze', color: 'linear-gradient(135deg, #B2EBF2, #E0F7FA)', desc: 'Cool ocean blue' },
    { name: 'Wood Surface', color: 'linear-gradient(135deg, #D7CCC8, #BCAAA4)', desc: 'Wood texture feel' },
  ];

  const panel = document.createElement('div');
  panel.className = 'layout-panel';
  panel.id = 'backgroundPanel';
  panel.style.left = panelLeft + 'px';
  panel.style.top = panelTop + 'px';
  panel.innerHTML = `
    <div class="layout-panel-header" id="bgDragHandle">
      <h3>E-commerce Background</h3>
      <button class="edit-text-panel-close" onclick="closeBackgroundPanel()">
        <i class="fi fi-rr-cross-small" style="font-size:14px;"></i>
      </button>
    </div>
    <div class="layout-panel-body">
      <div class="layout-grid">
        ${backgrounds.map((bg, i) => `
          <div class="layout-grid-item ${i === 0 ? 'active' : ''}" onclick="selectBackground(this, ${i})" title="${bg.name}"
               style="background:${bg.color};${bg.name === 'Dark Elegance' ? 'color:#fff;' : ''}">
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:${bg.name === 'Dark Elegance' ? '#ccc' : '#888'};text-align:center;padding:6px;">${bg.name}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Make draggable
  const handle = panel.querySelector('#bgDragHandle');
  let isDragging = false, startX, startY, startLeft, startTop;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.edit-text-panel-close')) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    startLeft = panel.offsetLeft; startTop = panel.offsetTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (startLeft + e.clientX - startX) + 'px';
    panel.style.top = (startTop + e.clientY - startY) + 'px';
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
}

function closeBackgroundPanel() {
  const panel = document.getElementById('backgroundPanel');
  if (panel) panel.remove();
}

function selectBackground(item, index) {
  item.closest('.layout-grid').querySelectorAll('.layout-grid-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  console.log('Background selected:', index);
  // TODO: apply background to mockup scene and generate e-commerce image
}

function initLayoutPanelDrag(panel) {
  const handle = panel.querySelector('#layoutDragHandle');
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.edit-text-panel-close')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = panel.offsetLeft;
    startTop = panel.offsetTop;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (startLeft + e.clientX - startX) + 'px';
    panel.style.top = (startTop + e.clientY - startY) + 'px';
  });

  window.addEventListener('mouseup', () => { isDragging = false; });
}

// ============ Drag to move cards ============
let dragCard = null;
let dragOffset = { x: 0, y: 0 };

// Mousedown on card-body starts drag (but not on toolbar links or resize handles)
canvasContent.addEventListener('mousedown', (e) => {
  if (e.target.closest('.card-toolbar-link') || e.target.closest('.card-download-btn')) return;
  if (e.target.closest('.resize-handle')) return; // handled by resize logic
  if (e.target.closest('.mockup-iframe') || e.target.tagName === 'IFRAME') return; // let iframe be interactive

  const cardBody = e.target.closest('.card-body');
  if (cardBody) {
    const card = cardBody.closest('.design-card');
    dragCard = card;
    const rect = card.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    card.style.zIndex = 100;
    e.preventDefault();
    e.stopPropagation();
  }
});

const SNAP_THRESHOLD = 5; // px in canvas space

window.addEventListener('mousemove', (e) => {
  if (dragCard) {
    const contentRect = canvasContent.getBoundingClientRect();
    let x = (e.clientX - contentRect.left - dragOffset.x) / zoomScale;
    let y = (e.clientY - contentRect.top - dragOffset.y) / zoomScale;
    // Allow free movement in all directions (no clamping)

    const body = dragCard.querySelector('.card-body');
    const w = body.offsetWidth;
    const h = body.offsetHeight;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const right = x + w;
    const bottom = y + h;

    // Collect edges of other cards
    const guides = [];
    clearAlignmentGuides();
    document.querySelectorAll('.design-card').forEach(card => {
      if (card === dragCard) return;
      const cb = card.querySelector('.card-body');
      const ox = parseFloat(card.style.left);
      const oy = parseFloat(card.style.top);
      const ow = cb.offsetWidth;
      const oh = cb.offsetHeight;
      const ocx = ox + ow / 2;
      const ocy = oy + oh / 2;

      // Vertical guides: left-left, right-right, center-center, left-right, right-left
      const vEdges = [
        { src: x, target: ox, label: 'left-left' },
        { src: right, target: ox + ow, label: 'right-right' },
        { src: cx, target: ocx, label: 'center-center-v' },
        { src: x, target: ox + ow, label: 'left-right' },
        { src: right, target: ox, label: 'right-left' },
      ];
      for (const ve of vEdges) {
        if (Math.abs(ve.src - ve.target) < SNAP_THRESHOLD) {
          x += (ve.target - ve.src);
          guides.push({ type: 'vertical', pos: ve.target });
          break;
        }
      }

      // Horizontal guides: top-top, bottom-bottom, center-center, top-bottom, bottom-top
      const hEdges = [
        { src: y, target: oy, label: 'top-top' },
        { src: bottom, target: oy + oh, label: 'bottom-bottom' },
        { src: cy, target: ocy, label: 'center-center-h' },
        { src: y, target: oy + oh, label: 'top-bottom' },
        { src: bottom, target: oy, label: 'bottom-top' },
      ];
      for (const he of hEdges) {
        if (Math.abs(he.src - he.target) < SNAP_THRESHOLD) {
          y += (he.target - he.src);
          guides.push({ type: 'horizontal', pos: he.target });
          break;
        }
      }
    });

    dragCard.style.left = x + 'px';
    dragCard.style.top = y + 'px';

    // Draw guides
    guides.forEach(g => {
      const line = document.createElement('div');
      line.className = 'alignment-guide ' + g.type;
      if (g.type === 'horizontal') line.style.top = g.pos + 'px';
      else line.style.left = g.pos + 'px';
      canvasContent.appendChild(line);
    });
  }
  if (resizeState) {
    handleResize(e);
  }
});

function clearAlignmentGuides() {
  canvasContent.querySelectorAll('.alignment-guide').forEach(g => g.remove());
}

window.addEventListener('mouseup', () => {
  if (dragCard) {
    dragCard.style.zIndex = '';
    dragCard = null;
    clearAlignmentGuides();
  }
  resizeState = null;
});

// ============ Resize cards ============
let resizeState = null;

canvasContent.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.resize-handle');
  if (!handle) return;

  const cardBody = handle.closest('.card-body');
  const card = cardBody.closest('.design-card');
  const rect = cardBody.getBoundingClientRect();

  // Determine direction from handle classes
  const classes = handle.className;
  const dir = classes.includes('tl') ? 'tl' : classes.includes('tr') ? 'tr' :
              classes.includes('bl') ? 'bl' : classes.includes('br') ? 'br' :
              classes.includes('tm') ? 'tm' : classes.includes('bm') ? 'bm' :
              classes.includes('ml') ? 'ml' : 'mr';

  resizeState = {
    card, cardBody, dir,
    startX: e.clientX, startY: e.clientY,
    startW: cardBody.offsetWidth, startH: cardBody.offsetHeight,
    startLeft: parseFloat(card.style.left), startTop: parseFloat(card.style.top)
  };

  e.preventDefault();
  e.stopPropagation();
});

function handleResize(e) {
  const s = resizeState;
  const dx = (e.clientX - s.startX) / zoomScale;
  const dy = (e.clientY - s.startY) / zoomScale;
  const aspect = s.startW / s.startH;

  let newW = s.startW, newH = s.startH;
  let newLeft = s.startLeft, newTop = s.startTop;

  // Corner handles: proportional resize (aspect-ratio locked)
  if (s.dir === 'br') {
    newW = Math.max(80, s.startW + dx);
    newH = newW / aspect;
  } else if (s.dir === 'bl') {
    newW = Math.max(80, s.startW - dx);
    newH = newW / aspect;
    newLeft = s.startLeft + (s.startW - newW);
  } else if (s.dir === 'tr') {
    newW = Math.max(80, s.startW + dx);
    newH = newW / aspect;
    newTop = s.startTop + (s.startH - newH);
  } else if (s.dir === 'tl') {
    newW = Math.max(80, s.startW - dx);
    newH = newW / aspect;
    newLeft = s.startLeft + (s.startW - newW);
    newTop = s.startTop + (s.startH - newH);
  }
  // Edge handles: also proportional by default
  else if (s.dir === 'mr' || s.dir === 'ml') {
    if (s.dir === 'mr') newW = Math.max(80, s.startW + dx);
    else { newW = Math.max(80, s.startW - dx); newLeft = s.startLeft + (s.startW - newW); }
    newH = newW / aspect;
  } else if (s.dir === 'tm' || s.dir === 'bm') {
    if (s.dir === 'bm') newH = Math.max(60, s.startH + dy);
    else { newH = Math.max(60, s.startH - dy); newTop = s.startTop + (s.startH - newH); }
    newW = newH * aspect;
  }

  s.cardBody.style.width = newW + 'px';
  s.cardBody.style.height = newH + 'px';
  s.card.style.left = newLeft + 'px';
  s.card.style.top = newTop + 'px';
}

// ============ Delete selected card ============
function deleteSelectedCard() {
  const selected = document.querySelector('.design-card.selected');
  if (selected) {
    selected.remove();
    const dialog = document.querySelector('.inline-edit-dialog');
    if (dialog) dialog.remove();
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'IFRAME') return;
    if (deleteSelectedCard()) {
      e.preventDefault();
    }
  }
});

// Also listen on the canvas viewport directly for when iframe steals focus
canvasViewport.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (deleteSelectedCard()) {
      e.preventDefault();
    }
  }
});

// Make canvas viewport focusable
canvasViewport.setAttribute('tabindex', '-1');

// ============ Pin placement & inline dialog ============
// Each card tracks its own pin counter
const cardPinCounters = new WeakMap();

function getPinCount(card) {
  return cardPinCounters.get(card) || 0;
}

function addPinToCard(card, cardBody, xPct, yPct) {
  const count = getPinCount(card) + 1;
  cardPinCounters.set(card, count);

  // Cache pin position for Feature 1
  cachePinPosition(card, xPct, yPct, count);

  // Create pin with number
  const pin = document.createElement('div');
  pin.className = 'pin-marker';
  pin.dataset.pinId = count;
  pin.style.left = xPct + '%';
  pin.style.top = yPct + '%';
  pin.innerHTML = `
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#00BCD4"/>
      <text x="12" y="12" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">${count}</text>
    </svg>`;
  cardBody.appendChild(pin);

  // Update or create dialog
  updateInlineDialog(card);
}

function updateInlineDialog(card) {
  const cardBody = card.querySelector('.card-body');
  const pins = cardBody.querySelectorAll('.pin-marker');

  // Build tags string
  const tags = Array.from(pins).map(p => `#pin${p.dataset.pinId}`).join('  ');

  let dialog = card.querySelector('.inline-edit-dialog');
  if (!dialog) {
    dialog = document.createElement('div');
    dialog.className = 'inline-edit-dialog';
    card.appendChild(dialog);
  }

  const inv = 1 / zoomScale;
  dialog.style.transform = `scale(${inv})`;
  dialog.style.transformOrigin = 'left top';

  dialog.innerHTML = `
    <div class="inline-dialog-header">
      <div class="inline-dialog-tags">${
        Array.from(pins).map(p =>
          `<span class="inline-dialog-tag-chip">#pin${p.dataset.pinId}</span>`
        ).join('')
      }</div>
      <button class="inline-dialog-close" onclick="clearPins(this)">
        <i class="fi fi-rr-cross-small" style="font-size:12px;"></i>
      </button>
    </div>
    <div class="inline-dialog-input-wrap">
      <input type="text" class="inline-dialog-input" placeholder="Describe what to modify at these pins...">
      <button class="inline-dialog-send">
        <i class="fi fi-sr-paper-plane" style="font-size:12px;color:#fff;"></i>
      </button>
    </div>
  `;

  dialog.querySelector('.inline-dialog-input').focus();
}

function clearPins(closeBtn) {
  const card = closeBtn.closest('.design-card');
  const cardBody = card.querySelector('.card-body');
  cardBody.querySelectorAll('.pin-marker').forEach(p => p.remove());
  cardPinCounters.set(card, 0);
  const dialog = card.querySelector('.inline-edit-dialog');
  if (dialog) dialog.remove();
}

// Click on card-body to place a pin (only in pin mode)
canvasContent.addEventListener('click', (e) => {
  if (currentToolMode !== 'pin') return;

  const cardBody = e.target.closest('.card-body');
  if (!cardBody) return;
  // Ignore clicks on toolbar, handles, existing pins, dialogs
  if (e.target.closest('.card-toolbar-link') || e.target.closest('.card-download-btn') ||
      e.target.closest('.resize-handle') || e.target.closest('.pin-marker') ||
      e.target.closest('.inline-edit-dialog') || e.target.closest('.card-toolbar-icon') ||
      e.target.closest('.card-toolbar')) return;

  const card = cardBody.closest('.design-card');
  const rect = cardBody.getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
  const yPct = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);

  addPinToCard(card, cardBody, xPct, yPct);
});

// ============ Copy / Paste cards ============
let copiedCard = null;
let lastMouseCanvas = { x: 400, y: 300 }; // fallback

// Track mouse position over the canvas in canvas-content coordinates
canvasViewport.addEventListener('mousemove', (e) => {
  const rect = canvasContent.getBoundingClientRect();
  lastMouseCanvas.x = (e.clientX - rect.left) / zoomScale;
  lastMouseCanvas.y = (e.clientY - rect.top) / zoomScale;
});

window.addEventListener('keydown', (e) => {
  // Ignore if typing in an input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const mod = isMac ? e.metaKey : e.ctrlKey;

  // Ctrl/Cmd + C  — copy selected card
  if (mod && e.key === 'c') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) {
      copiedCard = selected;
      // Don't preventDefault so normal copy still works if nothing is selected
    }
  }

  // Ctrl/Cmd + V  — paste copied card at mouse position
  if (mod && e.key === 'v') {
    if (!copiedCard) return;
    e.preventDefault();

    const clone = copiedCard.cloneNode(true);

    // Remove old id to avoid duplicates
    clone.removeAttribute('id');

    // Position at current mouse location
    clone.style.left = lastMouseCanvas.x + 'px';
    clone.style.top = lastMouseCanvas.y + 'px';

    // Remove .selected class from clone
    clone.classList.remove('selected');

    // Clear any pins from the clone and reset pin counter
    clone.querySelectorAll('.pin-marker').forEach(p => p.remove());
    delete clone.dataset.pinCount;

    // Append to canvas
    canvasContent.appendChild(clone);

    // Re-wire iframe if it exists (iframe content doesn't survive cloneNode)
    const iframeSrc = clone.querySelector('.mockup-iframe');
    if (iframeSrc) {
      iframeSrc.src = iframeSrc.src; // reload
    }

    // Select the new card
    selectCard(clone);
    applyZoom();
  }
});

// ============ Context Menu ============
const contextMenu = document.getElementById('contextMenu');
let ctxTarget = null;  // the card being right-clicked
let ctxMouseX = 0, ctxMouseY = 0;  // mouse position in canvas coords for paste

function showContextMenu(e, card) {
  ctxTarget = card;
  selectCard(card);
  applyZoom();

  const menu = contextMenu;
  menu.classList.add('visible');

  // Position near click, keep within viewport
  let x = e.clientX;
  let y = e.clientY;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Store canvas coords for paste
  const rect = canvasViewport.getBoundingClientRect();
  ctxMouseX = (e.clientX - rect.left - panX) / zoomScale;
  ctxMouseY = (e.clientY - rect.top - panY) / zoomScale;
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
}

// Right-click on card body
canvasViewport.addEventListener('contextmenu', (e) => {
  const cardBody = e.target.closest('.card-body');
  if (cardBody) {
    e.preventDefault();
    const card = cardBody.closest('.design-card');
    showContextMenu(e, card);
  } else {
    hideContextMenu();
  }
});

// Hide on any click elsewhere
document.addEventListener('click', () => hideContextMenu());
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.card-body')) hideContextMenu();
});
window.addEventListener('scroll', () => hideContextMenu(), true);

// --- Context menu actions ---

function ctxCopy() {
  hideContextMenu();
  if (!ctxTarget) return;
  copiedCard = ctxTarget;
}

function ctxCut() {
  hideContextMenu();
  if (!ctxTarget) return;
  copiedCard = ctxTarget;
  ctxTarget.remove();
  ctxTarget = null;
}

function ctxPaste() {
  hideContextMenu();
  if (!copiedCard) return;
  const clone = copiedCard.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove('selected');
  clone.querySelectorAll('.pin-marker').forEach(p => p.remove());
  clone.style.left = ctxMouseX + 'px';
  clone.style.top = ctxMouseY + 'px';
  canvasContent.appendChild(clone);
  const iframeSrc = clone.querySelector('.mockup-iframe');
  if (iframeSrc) iframeSrc.src = iframeSrc.src;
  selectCard(clone);
  applyZoom();
}

function ctxDuplicate() {
  hideContextMenu();
  if (!ctxTarget) return;
  const clone = ctxTarget.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove('selected');
  clone.querySelectorAll('.pin-marker').forEach(p => p.remove());
  // Offset slightly from original
  const origX = parseFloat(ctxTarget.style.left) || 0;
  const origY = parseFloat(ctxTarget.style.top) || 0;
  clone.style.left = (origX + 20) + 'px';
  clone.style.top = (origY + 20) + 'px';
  canvasContent.appendChild(clone);
  const iframeSrc = clone.querySelector('.mockup-iframe');
  if (iframeSrc) iframeSrc.src = iframeSrc.src;
  selectCard(clone);
  applyZoom();
}

function ctxMoveUp() {
  hideContextMenu();
  if (!ctxTarget) return;
  const next = ctxTarget.nextElementSibling;
  if (next && next.classList.contains('design-card')) {
    next.after(ctxTarget);
  }
}

function ctxMoveDown() {
  hideContextMenu();
  if (!ctxTarget) return;
  const prev = ctxTarget.previousElementSibling;
  if (prev && prev.classList.contains('design-card')) {
    prev.before(ctxTarget);
  }
}

function ctxBringToFront() {
  hideContextMenu();
  if (!ctxTarget) return;
  canvasContent.appendChild(ctxTarget);
}

function ctxSendToBack() {
  hideContextMenu();
  if (!ctxTarget) return;
  canvasContent.insertBefore(ctxTarget, canvasContent.firstChild);
}

// Keyboard shortcuts for context menu actions (when not typing)
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const mod = e.metaKey || e.ctrlKey;

  // ⌘X cut
  if (mod && e.key === 'x') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) {
      e.preventDefault();
      copiedCard = selected;
      selected.remove();
    }
  }

  // ⌘D duplicate
  if (mod && e.key === 'd') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) {
      e.preventDefault();
      ctxTarget = selected;
      ctxDuplicate();
    }
  }

  // ⌘] move up
  if (mod && e.key === ']') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) { e.preventDefault(); ctxTarget = selected; ctxMoveUp(); }
  }

  // ⌘[ move down
  if (mod && e.key === '[') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) { e.preventDefault(); ctxTarget = selected; ctxMoveDown(); }
  }

  // ] bring to front (no modifier)
  if (!mod && e.key === ']') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) { ctxTarget = selected; ctxBringToFront(); }
  }

  // [ send to back (no modifier)
  if (!mod && e.key === '[') {
    const selected = document.querySelector('.design-card.selected');
    if (selected) { ctxTarget = selected; ctxSendToBack(); }
  }
});

// ============ Feature 1: Enhanced Pin with coordinate caching & image regeneration ============
const pinCache = new Map(); // cardId -> [{x, y, pinId, description}]

function cachePinPosition(card, xPct, yPct, pinId) {
  const cardId = card.id || card.dataset.type + '-' + Date.now();
  if (!card.id) card.id = cardId;

  if (!pinCache.has(cardId)) pinCache.set(cardId, []);
  pinCache.get(cardId).push({ x: parseFloat(xPct), y: parseFloat(yPct), pinId, description: '' });
}

// Handle pin dialog send: regenerate image and place beside original
async function handlePinSend(card) {
  const dialog = card.querySelector('.inline-edit-dialog');
  if (!dialog) return;
  const input = dialog.querySelector('.inline-dialog-input');
  if (!input || !input.value.trim()) return;

  const description = input.value.trim();
  const cardId = card.id;
  const pins = pinCache.get(cardId) || [];

  // Update descriptions
  pins.forEach(p => { p.description = description; });

  const body = card.querySelector('.card-body');
  const origX = parseFloat(card.style.left) || 0;
  const origY = parseFloat(card.style.top) || 0;
  const origW = body.offsetWidth;
  const origH = body.offsetHeight;
  const cardType = card.dataset.type || 'creation';

  // Get label info from source card
  const origLabel = body.querySelector('.card-label');
  const origLabelText = origLabel ? origLabel.textContent.replace(/\s*\(Modified\)/, '') : '# 2D Creation';
  const origLabelClass = origLabel ? origLabel.className : 'card-label creation-label';

  // Clear pins on original card first
  clearPinsForCard(card);

  // Create loading card
  const spot = { x: origX + origW + 30, y: origY + 20 };
  const loadingCard = createLoadingDielineCard(spot, origW, origH, {
    type: cardType,
    label: origLabelText,
    labelClass: origLabelClass
  });
  const genLabel = loadingCard.querySelector('.generating-label');
  if (genLabel) genLabel.textContent = 'AI Modifying...';

  panToReveal(spot.x + origW / 2, spot.y + origH / 2);

  // Try to get image base64
  // First check stored base64 (for AI-generated cards that can't be drawn via canvas due to CORS)
  let imageBase64 = card.dataset.storedBase64 || null;
  if (!imageBase64) {
    try { imageBase64 = getCardImageAsBase64(card); } catch (e) {}
  }
  const imageUrlPin = !imageBase64 ? getCardImageUrl(card) : null;

  // Determine API size
  const aspect = origW / origH;
  let apiSize = '1024x1024';
  if (aspect > 1.3) apiSize = '1536x1024';
  else if (aspect < 0.77) apiSize = '1024x1536';

  // Call AI API
  let generatedImageUrl = null;
  if (imageBase64 || imageUrlPin) {
    try {
      const res = await fetch('/api/pin-edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageBase64 || undefined, imageUrl: imageBase64 ? undefined : imageUrlPin, description, pins, size: apiSize })
      });
      const data = await res.json();
      if (res.ok && data.imageUrl) {
        generatedImageUrl = data.imageUrl;
      } else {
        console.warn('Pin edit API error, fallback to clone:', data.error);
      }
    } catch (err) {
      console.warn('Pin edit API failed, fallback to clone:', err);
    }
  }

  // Build the new card
  const newBody = loadingCard.querySelector('.card-body');
  newBody.style.width = origW + 'px';
  newBody.style.height = origH + 'px';

  if (generatedImageUrl) {
    // Store base64 on card so subsequent edits don't fail with CORS
    if (generatedImageUrl.startsWith('data:image')) {
      loadingCard.dataset.storedBase64 = generatedImageUrl.split(',')[1] || '';
    }
    newBody.innerHTML = `
      <div class="card-toolbar">
        <div class="card-toolbar-icon"><i class="fi fi-rr-bulb" style="color:#7C3AED;font-size:12px;"></i></div>
        <span class="card-toolbar-link" onclick="event.stopPropagation(); editText(this)">Edit Text</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation();">Edit Elements</span>
        <span class="card-toolbar-sep">|</span>
        <button class="card-download-btn" onclick="event.stopPropagation();"><i class="fi fi-rr-download" style="font-size:12px;color:#333;"></i></button>
      </div>
      <div class="${origLabelClass}">${origLabelText}</div>
      <div class="card-mode-toggle" onclick="event.stopPropagation();">
        <span class="mode-btn active" onclick="switchCardMode(this, '2d')">2D</span>
        <span class="mode-sep">|</span>
        <span class="mode-btn" onclick="switchCardMode(this, '3d')">3D</span>
      </div>
      <img src="${generatedImageUrl}" alt="Modified" class="card-image" crossorigin="anonymous" style="width:100%;height:100%;object-fit:contain;">
      <div class="resize-handle tl"></div><div class="resize-handle tr"></div>
      <div class="resize-handle bl"></div><div class="resize-handle br"></div>
      <div class="resize-handle tm"></div><div class="resize-handle bm"></div>
      <div class="resize-handle ml"></div><div class="resize-handle mr"></div>
    `;
  } else {
    // Fallback: clone original
    const cloneBody = body.cloneNode(true);
    cloneBody.querySelectorAll('.pin-marker, .inline-edit-dialog, .dieline-3d-window, .dieline-3d-connector, .modify-history-bar').forEach(el => el.remove());
    cloneBody.style.width = origW + 'px';
    cloneBody.style.height = origH + 'px';
    newBody.replaceWith(cloneBody);
  }

  // Add Modify History bar below the card
  const historyBar = document.createElement('div');
  historyBar.className = 'modify-history-bar';
  historyBar.innerHTML = `
    <div class="modify-history-toggle" onclick="event.stopPropagation(); toggleModifyHistory(this)">
      <svg width="12" height="12" viewBox="0 0 12 12" class="modify-history-arrow">
        <path d="M4 3l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>Modify history</span>
    </div>
    <div class="modify-history-content" style="display:none;">
      <div class="diff-item">
        <strong>Pin Edit Request</strong>
        <div style="font-size:12px;color:var(--text-primary);margin-top:4px;">${description}</div>
        <div class="diff-style-change" style="margin-top:4px;">
          ${pins.map(p => `Pin #${p.pinId} at (${p.x}%, ${p.y}%)`).join(' · ')}
        </div>
      </div>
    </div>
  `;
  loadingCard.appendChild(historyBar);

  // Re-attach 3D sidebar
  if (cardType === 'dieline') {
    attachDieline3DSidebar(loadingCard);
  }

  applyZoom();
}

// Delegate click on send button inside inline dialog
document.addEventListener('click', (e) => {
  const sendBtn = e.target.closest('.inline-dialog-send');
  if (!sendBtn) return;
  e.stopPropagation();
  e.preventDefault();
  const card = sendBtn.closest('.design-card');
  if (card) handlePinSend(card);
});

// Also handle Enter key in pin dialog input
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('inline-dialog-input')) {
    const card = e.target.closest('.design-card');
    if (card) handlePinSend(card);
  }
});

// ============ Feature 2: Edit Text Panel - AI text extraction ============
// Close all floating panels (Edit Text, Edit Elements, Layout, Background)
function closeAllFloatingPanels() {
  closeEditTextPanel();
  closeEditElementsPanel();
  closeLayoutPanel();
  closeBackgroundPanel();
}

function openEditTextPanel(card) {
  // Close all other panels first — only one at a time
  closeAllFloatingPanels();

  const cardBody = card.querySelector('.card-body');
  const img = cardBody.querySelector('.card-image') || cardBody.querySelector('img');

  // Calculate position: to the right of the card
  const cardRect = cardBody.getBoundingClientRect();
  let panelLeft = cardRect.right + 16;
  let panelTop = cardRect.top;

  // If it would go off-screen right, put it to the left of the card
  const panelWidth = 420;
  if (panelLeft + panelWidth > window.innerWidth - 20) {
    panelLeft = cardRect.left - panelWidth - 16;
  }
  // Clamp to viewport
  panelLeft = Math.max(12, Math.min(panelLeft, window.innerWidth - panelWidth - 12));
  panelTop = Math.max(12, Math.min(panelTop, window.innerHeight - 300));

  // Create panel (no overlay — non-blocking floating window)
  const panel = document.createElement('div');
  panel.className = 'edit-text-panel';
  panel.id = 'editTextPanel';
  panel.style.left = panelLeft + 'px';
  panel.style.top = panelTop + 'px';
  panel.innerHTML = `
    <div class="edit-text-panel-header" id="editTextDragHandle">
      <h3 style="font-size:14px;margin:0;">Edit Text</h3>
      <button class="edit-text-panel-close" onclick="closeEditTextPanel()">
        <i class="fi fi-rr-cross-small" style="font-size:14px;"></i>
      </button>
    </div>
    <div class="edit-text-panel-body" id="editTextPanelBody">
      <div class="edit-text-loading">
        Extracting text from image<span class="loading-dots"><span></span><span></span><span></span></span>
      </div>
    </div>
    <div class="edit-text-panel-footer">
      <button class="edit-text-cancel-btn" onclick="closeEditTextPanel()">Cancel</button>
      <button class="edit-text-save-btn" onclick="saveEditText()">Apply Changes</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Make panel draggable by header
  initEditTextDrag(panel);

  // Ensure card has an id for reference
  if (!card.id) card.id = 'card-' + Date.now();

  // Store reference to the card
  panel.dataset.cardId = card.id;
  panel._card = card;

  // Extract text via AI
  extractTextFromCard(card, img);
}

// Drag logic for the Edit Text floating window
function initEditTextDrag(panel) {
  const handle = panel.querySelector('#editTextDragHandle');
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    // Ignore if clicking close button
    if (e.target.closest('.edit-text-panel-close')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = panel.offsetLeft;
    startTop = panel.offsetTop;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = (startLeft + dx) + 'px';
    panel.style.top = (startTop + dy) + 'px';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// Default demo texts for initial extraction
const DEFAULT_DEMO_TEXTS = [
  { label: 'Brand Name', text: 'Mother Dairy', font: 'serif', size: 36, align: 'center' },
  { label: 'Sub Brand', text: 'Flavoured', font: 'serif', size: 24, align: 'center' },
  { label: 'Flavor', text: 'Vanilla', font: 'sans-serif', size: 28, align: 'center' },
  { label: 'Product Type', text: 'Flavored Milk', font: 'sans-serif', size: 14, align: 'center' },
  { label: 'Tagline', text: 'READY TO DRINK', font: 'sans-serif', size: 12, align: 'left' },
  { label: 'Step 1', text: 'Twist', font: 'sans-serif', size: 12, align: 'left' },
  { label: 'Step 2', text: 'Insert Straw / Attach nipple', font: 'sans-serif', size: 12, align: 'left' },
  { label: 'Step 3', text: 'Enjoy', font: 'sans-serif', size: 12, align: 'left' },
  { label: 'Storage', text: 'Once opened, please refrigerate and consume on the same day.', font: 'sans-serif', size: 10, align: 'left' },
  { label: 'Best Before', text: 'Best before: See at top of pack', font: 'sans-serif', size: 10, align: 'left' },
  { label: 'Social', text: '@motherdairymy', font: 'sans-serif', size: 11, align: 'left' },
  { label: 'Language Note', text: '* Malaysia National Language', font: 'sans-serif', size: 9, align: 'left' },
  { label: 'Local Text', text: 'Naith haarnay\nIdc per Verkary Milk', font: 'sans-serif', size: 11, align: 'center' },
  { label: 'Nutrition Title', text: 'Nutrition Information', font: 'sans-serif', size: 12, align: 'center' },
  { label: 'Badge', text: 'ENGAN PRENDITE S CABE', font: 'sans-serif', size: 9, align: 'center' },
];

// Store per-card text state: cardId -> [{label, text, font, size, align}]
const cardTextState = new Map();

async function extractTextFromCard(card, img) {
  const cardId = card.id || '';

  // If we already have stored state for this card, use it directly
  if (cardTextState.has(cardId)) {
    renderTextRows(cardTextState.get(cardId));
    return;
  }

  // Try AI extraction via GPT-4o Vision
  // First check stored base64 (for AI-generated cards that can't be drawn via canvas due to CORS)
  let imageBase64 = card.dataset.storedBase64 || null;
  if (!imageBase64) {
    try { imageBase64 = getCardImageAsBase64(card); } catch (e) {}
  }
  const imageUrl = getCardImageUrl(card); // fallback URL for server-side fetch

  let texts = null;
  if (imageBase64 || imageUrl) {
    try {
      const res = await fetch('/api/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageBase64 || undefined, imageUrl: imageBase64 ? undefined : imageUrl })
      });
      const data = await res.json();
      if (res.ok && data.texts && data.texts.length > 0) {
        texts = data.texts;
      } else {
        console.warn('Text extraction API error, using fallback:', data.error);
      }
    } catch (err) {
      console.warn('Text extraction failed, using fallback:', err);
    }
  }

  // Fallback to demo texts only if AI extraction failed
  if (!texts) {
    texts = DEFAULT_DEMO_TEXTS.map(t => ({ ...t }));
  }

  // Check if panel still exists
  if (!document.getElementById('editTextPanelBody')) return;

  // Store and render
  if (cardId) cardTextState.set(cardId, texts);
  renderTextRows(texts);
}

function renderTextRows(texts) {
  const body = document.getElementById('editTextPanelBody');
  if (!body) return;

  body.innerHTML = texts.map((item, i) => `
    <div class="edit-text-row" data-index="${i}"
         data-orig-text="${(item.text || '').replace(/"/g, '&quot;')}"
         data-orig-font="${item.font || 'sans-serif'}"
         data-orig-size="${item.size || 14}"
         data-orig-align="${item.align || 'left'}">
      <div class="edit-text-row-label">${item.label || 'Text ' + (i+1)}</div>
      <textarea class="edit-text-input" rows="${(item.text || '').includes('\n') ? 2 : 1}">${item.text || ''}</textarea>
      <div class="edit-text-controls">
        <select class="edit-text-font" title="Font Family">
          <option value="sans-serif" ${(item.font||'sans-serif') === 'sans-serif' ? 'selected' : ''}>Sans-serif</option>
          <option value="serif" ${item.font === 'serif' ? 'selected' : ''}>Serif</option>
          <option value="monospace" ${item.font === 'monospace' ? 'selected' : ''}>Monospace</option>
          <option value="cursive" ${item.font === 'cursive' ? 'selected' : ''}>Cursive</option>
        </select>
        <input type="number" class="edit-text-size" value="${item.size || 14}" min="6" max="120" title="Font Size">
        <button class="edit-text-align-btn ${(item.align||'left') === 'left' ? 'active' : ''}" data-align="left" title="Left Align" onclick="setTextAlign(this, 'left')">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M2 6h6M2 9h8M2 12h4" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        <button class="edit-text-align-btn ${item.align === 'center' ? 'active' : ''}" data-align="center" title="Center Align" onclick="setTextAlign(this, 'center')">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M4 6h6M3 9h8M5 12h4" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        <button class="edit-text-align-btn ${item.align === 'right' ? 'active' : ''}" data-align="right" title="Right Align" onclick="setTextAlign(this, 'right')">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 3h10M6 6h6M4 9h8M8 12h4" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function setTextAlign(btn, align) {
  const row = btn.closest('.edit-text-row');
  row.querySelectorAll('.edit-text-align-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function closeEditTextPanel() {
  const panel = document.getElementById('editTextPanel');
  if (panel) panel.remove();
}

function saveEditText() {
  const panel = document.getElementById('editTextPanel');
  if (!panel) return;

  // Detect changes by comparing current values with originals
  const rows = panel.querySelectorAll('.edit-text-row');
  const diffs = [];

  rows.forEach(row => {
    const label = row.querySelector('.edit-text-row-label').textContent;
    const curText = row.querySelector('.edit-text-input').value;
    const curFont = row.querySelector('.edit-text-font').value;
    const curSize = row.querySelector('.edit-text-size').value;
    const activeAlign = row.querySelector('.edit-text-align-btn.active');
    const curAlign = activeAlign ? activeAlign.dataset.align : 'left';

    const origText = row.dataset.origText;
    const origFont = row.dataset.origFont;
    const origSize = row.dataset.origSize;
    const origAlign = row.dataset.origAlign;

    const changes = [];
    if (curText !== origText) changes.push({ field: 'text', from: origText, to: curText });
    if (curFont !== origFont) changes.push({ field: 'font', from: origFont, to: curFont });
    if (curSize !== origSize) changes.push({ field: 'size', from: origSize, to: curSize });
    if (curAlign !== origAlign) changes.push({ field: 'align', from: origAlign, to: curAlign });

    if (changes.length > 0) {
      diffs.push({ label, changes, curText, curFont, curSize, curAlign });
    }
  });

  // Collect ALL current values (not just diffs) for state storage
  const allTexts = [];
  rows.forEach(row => {
    const label = row.querySelector('.edit-text-row-label').textContent;
    const text = row.querySelector('.edit-text-input').value;
    const font = row.querySelector('.edit-text-font').value;
    const size = parseInt(row.querySelector('.edit-text-size').value);
    const activeAlign = row.querySelector('.edit-text-align-btn.active');
    const align = activeAlign ? activeAlign.dataset.align : 'left';
    allTexts.push({ label, text, font, size, align });
  });

  // Find the source card — use stored reference (dataset.cardId may be empty for cards without id)
  const sourceCard = panel._card || (panel.dataset.cardId ? document.getElementById(panel.dataset.cardId) : null);

  closeEditTextPanel();

  if (diffs.length === 0) {
    console.log('No text changes detected.');
    return;
  }

  console.log('Text diffs detected:', diffs);

  // Generate a new image card with the modified text
  if (sourceCard) {
    generateEditTextImage(sourceCard, diffs, allTexts);
  }
}

// Generate a new card with modified text next to the original via OpenAI
async function generateEditTextImage(sourceCard, diffs, allTexts) {
  const sourceBody = sourceCard.querySelector('.card-body');
  const origX = parseFloat(sourceCard.style.left) || 0;
  const origY = parseFloat(sourceCard.style.top) || 0;
  const origW = sourceBody.offsetWidth;
  const origH = sourceBody.offsetHeight;

  // Place loading card to the right of the source card (offset for visual separation)
  const spot = { x: origX + origW + 30, y: origY + 20 };

  // Get source card label info
  const origLabel = sourceBody.querySelector('.card-label');
  const origLabelText = origLabel ? origLabel.textContent.replace(/\s*\(Modified\)/, '') : '# 2D Creation';
  const origLabelClass = origLabel ? origLabel.className : 'card-label creation-label';
  const cardType = sourceCard.dataset.type || 'creation';

  // Create a loading card matching the source card type
  const loadingCard = createLoadingDielineCard(spot, origW, origH, {
    type: cardType,
    label: origLabelText,
    labelClass: origLabelClass
  });

  const genLabel = loadingCard.querySelector('.generating-label');
  if (genLabel) genLabel.textContent = 'Regenerating...';

  panToReveal(spot.x + origW / 2, spot.y + origH / 2);

  // Try to get image as base64 for the API call
  // First check stored base64 (for AI-generated cards that can't be drawn via canvas due to CORS)
  let imageBase64 = sourceCard.dataset.storedBase64 || null;
  if (!imageBase64) {
    try {
      imageBase64 = getCardImageAsBase64(sourceCard);
    } catch (e) {
      console.warn('Cannot get base64 from card image (will use URL fallback):', e);
    }
  }
  // URL fallback: server will fetch the image when base64 is unavailable
  const imageUrl = !imageBase64 ? getCardImageUrl(sourceCard) : null;

  // Build the diff HTML for the collapsible history bar
  const diffHtml = buildDiffHtml(diffs);

  // Determine best OpenAI image size based on original aspect ratio
  const aspect = origW / origH;
  let apiSize = '1024x1024';
  if (aspect > 1.3) apiSize = '1536x1024';  // landscape
  else if (aspect < 0.77) apiSize = '1024x1536'; // portrait

  // Call OpenAI API to regenerate the image
  let generatedImageUrl = null;
  if (imageBase64 || imageUrl) {
    try {
      const res = await fetch('/api/edit-text-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageBase64 || undefined, imageUrl: imageBase64 ? undefined : imageUrl, diffs, size: apiSize })
      });
      const data = await res.json();
      if (res.ok && data.imageUrl) {
        generatedImageUrl = data.imageUrl;
      } else {
        console.warn('API returned error, falling back to clone:', data.error);
      }
    } catch (err) {
      console.warn('Edit text image API failed, falling back to clone:', err);
    }
  }

  // Build the new card
  const cardBody = loadingCard.querySelector('.card-body');

  // Force new card to match original card's exact dimensions
  cardBody.style.width = origW + 'px';
  cardBody.style.height = origH + 'px';

  if (generatedImageUrl) {
    // API succeeded — show the AI-generated image
    // Store base64 on card so subsequent edits don't fail with CORS
    if (generatedImageUrl.startsWith('data:image')) {
      loadingCard.dataset.storedBase64 = generatedImageUrl.split(',')[1] || '';
    }
    cardBody.innerHTML = `
      <div class="card-toolbar">
        <div class="card-toolbar-icon">
          <i class="fi fi-rr-bulb" style="color:#7C3AED;font-size:12px;"></i>
        </div>
        <span class="card-toolbar-link" onclick="event.stopPropagation(); editText(this)">Edit Text</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation();">Edit Elements</span>
        <span class="card-toolbar-sep">|</span>
        <button class="card-download-btn" onclick="event.stopPropagation();">
          <i class="fi fi-rr-download" style="font-size:12px;color:#333;"></i>
        </button>
      </div>
      <div class="${origLabelClass}">${origLabelText}</div>
      <div class="card-mode-toggle" onclick="event.stopPropagation();">
        <span class="mode-btn active" onclick="switchCardMode(this, '2d')">2D</span>
        <span class="mode-sep">|</span>
        <span class="mode-btn" onclick="switchCardMode(this, '3d')">3D</span>
      </div>
      <img src="${generatedImageUrl}" alt="Modified" class="card-image" crossorigin="anonymous"
           style="width:100%;height:100%;object-fit:contain;">
      <div class="resize-handle tl"></div><div class="resize-handle tr"></div>
      <div class="resize-handle bl"></div><div class="resize-handle br"></div>
      <div class="resize-handle tm"></div><div class="resize-handle bm"></div>
      <div class="resize-handle ml"></div><div class="resize-handle mr"></div>
    `;
  } else {
    // Fallback: clone the original card image (API not configured or failed)
    const sourceBodyClone = sourceBody.cloneNode(true);
    sourceBodyClone.querySelectorAll('.pin-marker, .inline-edit-dialog, .dieline-3d-window, .modify-history-bar').forEach(el => el.remove());
    // Preserve original dimensions on clone
    sourceBodyClone.style.width = origW + 'px';
    sourceBodyClone.style.height = origH + 'px';
    cardBody.replaceWith(sourceBodyClone);
  }

  // Append collapsible Modify History bar BELOW the card body (not inside/overlapping the image)
  const historyBar = document.createElement('div');
  historyBar.className = 'modify-history-bar';
  historyBar.innerHTML = `
    <div class="modify-history-toggle" onclick="event.stopPropagation(); toggleModifyHistory(this)">
      <svg width="12" height="12" viewBox="0 0 12 12" class="modify-history-arrow">
        <path d="M4 3l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>Modify history</span>
    </div>
    <div class="modify-history-content" style="display:none;">
      ${diffHtml}
    </div>
  `;
  loadingCard.appendChild(historyBar);

  // Re-attach 3D sidebar for dieline cards
  if (cardType === 'dieline') {
    attachDieline3DSidebar(loadingCard);
  }

  // Store the updated text state on the new card so Edit Text shows current values
  if (allTexts && loadingCard.id) {
    cardTextState.set(loadingCard.id, allTexts);
  }

  applyZoom();
}

// Build diff HTML for modify history
function buildDiffHtml(diffs) {
  return diffs.map(d => {
    const textChange = d.changes.find(c => c.field === 'text');
    const styleChanges = d.changes.filter(c => c.field !== 'text');
    let html = `<div class="diff-item"><strong>${d.label}</strong>`;
    if (textChange) {
      html += `<div class="diff-text-change"><span class="diff-from">${textChange.from}</span> → <span class="diff-to">${textChange.to}</span></div>`;
    }
    if (styleChanges.length > 0) {
      html += `<div class="diff-style-change">${styleChanges.map(c => `${c.field}: ${c.from} → ${c.to}`).join(', ')}</div>`;
    }
    html += '</div>';
    return html;
  }).join('');
}

// Toggle modify history panel expand/collapse
function toggleModifyHistory(toggleEl) {
  const bar = toggleEl.closest('.modify-history-bar');
  const content = bar.querySelector('.modify-history-content');
  const arrow = bar.querySelector('.modify-history-arrow');
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? 'block' : 'none';
  arrow.style.transform = isHidden ? 'rotate(90deg)' : '';
  bar.classList.toggle('expanded', isHidden);
}

// Clear pins helper that works with any element inside the card
function clearPinsForCard(card) {
  const cardBody = card.querySelector('.card-body');
  if (cardBody) cardBody.querySelectorAll('.pin-marker').forEach(p => p.remove());
  cardPinCounters.set(card, 0);
  const dialog = card.querySelector('.inline-edit-dialog');
  if (dialog) dialog.remove();
}

// ============ Feature 3: 3D Model Window on Dieline cards ============
const DIELINE_3D_MODEL_URL = 'https://www.pacdora.com/share?filter_url=psm6n35gbf';

function attachDieline3DSidebar(card) {
  const cardBody = card.querySelector('.card-body');
  if (!cardBody || card.dataset.type !== 'dieline') return;

  // Don't add if already present
  if (card.querySelector('.dieline-3d-window')) return;

  // Size: height = half of card body height, width = height (square)
  const cardH = cardBody.offsetHeight || 400;
  const sideH = Math.round(cardH / 2);

  // Position: to the left of the card, top-aligned
  const windowEl = document.createElement('div');
  windowEl.className = 'dieline-3d-window';
  windowEl.style.width = sideH + 'px';
  windowEl.style.height = sideH + 'px';
  windowEl.style.position = 'absolute';
  const gap = 50; // horizontal gap for connector line
  windowEl.style.left = -(sideH + gap) + 'px';
  windowEl.style.top = '0px'; // top-aligned with card

  windowEl.innerHTML = `
    <iframe src="${DIELINE_3D_MODEL_URL}" allowfullscreen></iframe>
    <div class="dieline-3d-window-overlay">
      <button class="dieline-3d-window-btn" onclick="event.stopPropagation(); openModifyDielineDimension(this)">Modify Dieline Dimension</button>
      <button class="dieline-3d-window-btn" onclick="event.stopPropagation(); openChangeModel(this)">Change Model</button>
    </div>
  `;

  card.appendChild(windowEl);

  // Create SVG connector line between the 3D window and the card body
  const connector = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  connector.classList.add('dieline-3d-connector');
  connector.style.position = 'absolute';
  connector.style.overflow = 'visible';
  connector.style.left = '0';
  connector.style.top = '0';
  connector.style.width = '1px';
  connector.style.height = '1px';
  connector.innerHTML = `<line class="connector-line"/>`;
  card.appendChild(connector);

  // Update positions
  updateDieline3DPositions(card);

  // Check if currently in 3D mode — if so, hide
  const activeMode = cardBody.querySelector('.mode-btn.active');
  if (activeMode && activeMode.textContent.trim() === '3D') {
    windowEl.classList.add('hidden-3d');
    connector.classList.add('hidden-3d');
  }
}

function updateDieline3DPositions(card) {
  const cardBody = card.querySelector('.card-body');
  const windowEl = card.querySelector('.dieline-3d-window');
  const connector = card.querySelector('.dieline-3d-connector');
  if (!cardBody || !windowEl || !connector) return;

  const cardH = cardBody.offsetHeight || 400;
  const cardW = cardBody.offsetWidth || 500;
  const sideH = Math.round(cardH / 2);

  const gap = 50;
  // Update window size & position (top-aligned)
  windowEl.style.width = sideH + 'px';
  windowEl.style.height = sideH + 'px';
  windowEl.style.left = -(sideH + gap) + 'px';
  windowEl.style.top = '0px';

  // Connector: horizontal line from right edge of 3D window to left edge of card
  const lineY = sideH / 2; // vertical center of the 3D window
  const line = connector.querySelector('.connector-line');
  if (line) {
    line.setAttribute('x1', -gap);
    line.setAttribute('y1', lineY);
    line.setAttribute('x2', 0);
    line.setAttribute('y2', lineY);
  }
}

// Update sidebar size when card resizes
function updateDieline3DSidebarSize(cardBody) {
  const card = cardBody.closest('.design-card');
  if (card) updateDieline3DPositions(card);
}

// Modify Dieline Dimension modal
function openModifyDielineDimension(btn) {
  closeAllMiniModals();

  const overlay = document.createElement('div');
  overlay.className = 'model-overlay-bg';
  overlay.id = 'dielineDimOverlay';
  overlay.onclick = closeAllMiniModals;
  document.body.appendChild(overlay);

  const modal = document.createElement('div');
  modal.className = 'dieline-dimension-modal';
  modal.id = 'dielineDimModal';
  modal.innerHTML = `
    <h3>Modify Dieline Dimension</h3>
    <div class="dimension-input-group">
      <label>Width (mm)
        <input type="number" id="dielineWidth" value="200" min="10" max="2000">
      </label>
      <label>Height (mm)
        <input type="number" id="dielineHeight" value="280" min="10" max="2000">
      </label>
    </div>
    <div class="dimension-input-group">
      <label>Depth (mm)
        <input type="number" id="dielineDepth" value="60" min="1" max="1000">
      </label>
      <label>Unit
        <select id="dielineUnit">
          <option value="mm" selected>Millimeters (mm)</option>
          <option value="cm">Centimeters (cm)</option>
          <option value="in">Inches (in)</option>
        </select>
      </label>
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn-cancel" onclick="closeAllMiniModals()">Cancel</button>
      <button class="modal-btn-confirm" onclick="applyDielineDimension()">Apply</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function applyDielineDimension() {
  const w = document.getElementById('dielineWidth')?.value;
  const h = document.getElementById('dielineHeight')?.value;
  const d = document.getElementById('dielineDepth')?.value;
  console.log('Apply dieline dimensions:', { width: w, height: h, depth: d });
  closeAllMiniModals();
}

// Change Model modal
function openChangeModel(btn) {
  closeAllMiniModals();

  const overlay = document.createElement('div');
  overlay.className = 'model-overlay-bg';
  overlay.id = 'changeModelOverlay';
  overlay.onclick = closeAllMiniModals;
  document.body.appendChild(overlay);

  const models = [
    { name: 'Stand Up Pouch', url: 'https://www.pacdora.com/share?filter_url=psm6n35gbf' },
    { name: 'Box', url: 'https://www.pacdora.com/share?filter_url=psre5mjuiy' },
    { name: 'Bottle', url: 'https://www.pacdora.com/share?filter_url=psm6n35gbf' },
    { name: 'Bag', url: 'https://www.pacdora.com/share?filter_url=psre5mjuiy' },
    { name: 'Tube', url: 'https://www.pacdora.com/share?filter_url=psm6n35gbf' },
    { name: 'Can', url: 'https://www.pacdora.com/share?filter_url=psre5mjuiy' },
  ];

  const modal = document.createElement('div');
  modal.className = 'change-model-modal';
  modal.id = 'changeModelModal';
  modal.innerHTML = `
    <h3>Change 3D Model</h3>
    <div class="change-model-grid">
      ${models.map((m, i) => `
        <div class="change-model-item ${i === 0 ? 'active' : ''}" data-url="${m.url}" onclick="selectModel(this)">
          <iframe src="${m.url}" allowfullscreen></iframe>
        </div>
      `).join('')}
    </div>
    <div class="modal-btn-row">
      <button class="modal-btn-cancel" onclick="closeAllMiniModals()">Cancel</button>
      <button class="modal-btn-confirm" onclick="applyChangeModel()">Apply</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function selectModel(item) {
  item.closest('.change-model-grid').querySelectorAll('.change-model-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
}

function applyChangeModel() {
  const active = document.querySelector('.change-model-item.active');
  if (active) {
    const url = active.dataset.url;
    // Update all dieline 3D sidebars with new model
    document.querySelectorAll('.dieline-3d-window iframe').forEach(iframe => {
      iframe.src = url;
    });
    console.log('Changed model to:', url);
  }
  closeAllMiniModals();
}

function closeAllMiniModals() {
  ['dielineDimOverlay', 'dielineDimModal', 'changeModelOverlay', 'changeModelModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

// Attach 3D sidebars to all existing dieline cards
function initDieline3DSidebars() {
  document.querySelectorAll('.design-card[data-type="dieline"]').forEach(card => {
    attachDieline3DSidebar(card);
  });
}

// Observe new cards added to canvas
const canvasObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1 && node.classList.contains('design-card') && node.dataset.type === 'dieline') {
        // Delay slightly to let card render
        setTimeout(() => attachDieline3DSidebar(node), 100);
      }
    }
  }
});
canvasObserver.observe(canvasContent, { childList: true });

// Also update sidebar size after resize ends
const _origMouseUp = window.onmouseup;
window.addEventListener('mouseup', () => {
  if (resizeState) {
    const body = resizeState.cardBody;
    setTimeout(() => updateDieline3DSidebarSize(body), 50);
  }
});

// ============ Sync selected card image to chat panel ============
function syncSelectedCardToChat(card) {
  const refContainer = document.getElementById('chatRefImage');
  const refImg = document.getElementById('chatRefImageImg');
  if (!refContainer || !refImg) return;

  if (!card) {
    refContainer.style.display = 'none';
    return;
  }

  // Skip mockup (3D) cards
  if (card.dataset.type === 'mockup') {
    refContainer.style.display = 'none';
    return;
  }

  // Skip if card is in 3D mode
  const activeMode = card.querySelector('.mode-btn.active');
  if (activeMode && activeMode.textContent.trim() === '3D') {
    refContainer.style.display = 'none';
    return;
  }

  // Get the card image
  const img = card.querySelector('.card-image') || card.querySelector('img');
  if (!img || !img.src) {
    refContainer.style.display = 'none';
    return;
  }

  // Show thumbnail
  refImg.src = img.src;
  refContainer.style.display = 'flex';
}

function clearChatRefImage() {
  const ref = document.getElementById('chatRefImage');
  if (ref) ref.style.display = 'none';
}

// ============ Upload Image to Canvas ============
function uploadImageToCanvas() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.onchange = (e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        addToCanvas(ev.target.result);
      };
      reader.readAsDataURL(file);
    });
    fileInput.remove();
  };
  document.body.appendChild(fileInput);
  fileInput.click();
}

// ============ Paste Image on Canvas ============
document.addEventListener('paste', (e) => {
  // Don't intercept paste in input/textarea fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.target.closest('.edit-text-panel') || e.target.closest('.inline-edit-dialog')) return;

  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (ev) => {
        // Place at mouse position if available, otherwise use smart placement
        addToCanvas(ev.target.result);
      };
      reader.readAsDataURL(blob);
      return; // Only handle first image
    }
  }
});

// ============ Project Save / Load ============
let currentProjectId = null;

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || null;
}

function collectProjectState() {
  const cards = canvasContent.querySelectorAll('.design-card');
  const cardsData = [];
  cards.forEach(card => {
    const body = card.querySelector('.card-body');
    if (!body) return;
    cardsData.push({
      id: card.id || '',
      type: card.dataset.type,
      left: card.style.left,
      top: card.style.top,
      width: body.style.width,
      height: body.style.height,
      html: body.innerHTML,
      bodyClass: body.className,
      storedBase64: card.dataset.storedBase64 || ''
    });
  });
  return {
    projectId: currentProjectId,
    projectName: document.querySelector('.project-name').textContent,
    panX, panY, zoomScale,
    cards: cardsData,
    savedAt: new Date().toISOString()
  };
}

async function saveProjectState() {
  if (!currentProjectId) return;
  const state = collectProjectState();

  // Save to server (primary — persists across sessions and devices)
  try {
    const res = await fetch(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: state.projectName, cards_data: state })
    });
    if (res.ok) {
      // Also keep a lightweight localStorage copy as quick-load cache
      try { localStorage.setItem('project_' + currentProjectId, JSON.stringify(state)); } catch(e) {}
      return;
    }
  } catch (e) {
    console.warn('Server save failed, falling back to localStorage:', e.message);
  }

  // Fallback: localStorage only
  try {
    localStorage.setItem('project_' + currentProjectId, JSON.stringify(state));
  } catch (e) {
    console.warn('localStorage quota exceeded — project may not be saved:', e.message);
  }
}

function applyProjectState(state, projectId) {
  canvasContent.querySelectorAll('.design-card').forEach(c => c.remove());
  canvasContent.querySelectorAll('.demo-project-hint').forEach(h => h.remove());

  (state.cards || []).forEach(cd => {
    const card = document.createElement('div');
    card.className = 'design-card';
    if (cd.id) card.id = cd.id;
    card.dataset.type = cd.type || '';
    card.style.left = cd.left || '0px';
    card.style.top = cd.top || '0px';
    if (cd.storedBase64) card.dataset.storedBase64 = cd.storedBase64;
    const body = document.createElement('div');
    body.className = cd.bodyClass || 'card-body';
    body.innerHTML = cd.html || '';
    if (cd.width) body.style.width = cd.width;
    if (cd.height) body.style.height = cd.height;
    card.appendChild(body);
    canvasContent.appendChild(card);
  });

  panX = state.panX || 0;
  panY = state.panY || 0;
  zoomScale = state.zoomScale || 1;
  document.querySelector('.project-name').textContent = state.projectName || 'Project';
  currentProjectId = projectId;

  applyZoom();
  initDieline3DSidebars();
}

async function loadProjectState(projectId) {
  // Try server first
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) {
      const project = await res.json();
      if (project.cards_data) {
        let state;
        try {
          state = typeof project.cards_data === 'string'
            ? JSON.parse(project.cards_data)
            : project.cards_data;
        } catch (e) { /* invalid JSON */ }
        if (state && Array.isArray(state.cards) && state.cards.length > 0) {
          applyProjectState(state, projectId);
          return true;
        }
      }
    }
  } catch (e) {
    console.warn('Server load failed, trying localStorage:', e.message);
  }

  // Fallback: localStorage
  try {
    const raw = localStorage.getItem('project_' + projectId);
    if (raw) {
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.cards) && state.cards.length > 0) {
        applyProjectState(state, projectId);
        return true;
      }
    }
  } catch (e) {
    console.error('localStorage load failed:', e);
  }

  return false;
}

// Auto-save every 10 seconds
setInterval(() => saveProjectState(), 10000);

// Save before unload — sync to localStorage as instant backup, then async to server
window.addEventListener('beforeunload', () => {
  if (!currentProjectId) return;
  const state = collectProjectState();
  try { localStorage.setItem('project_' + currentProjectId, JSON.stringify(state)); } catch(e) {}
  // Beacon to server (fire-and-forget, browser may complete even after page closes)
  try {
    navigator.sendBeacon(`/api/projects/${currentProjectId}/beacon`,
      new Blob([JSON.stringify({ name: state.projectName, cards_data: state })],
        { type: 'application/json' }));
  } catch(e) {}
});

// ============ Init ============
(async function initProject() {
  const urlProjectId = getProjectIdFromUrl();
  if (urlProjectId) {
    currentProjectId = urlProjectId;
    const loaded = await loadProjectState(urlProjectId);
    if (!loaded) {
      applyZoom();
      initDieline3DSidebars();
    }
  } else {
    applyZoom();
    initDieline3DSidebars();
  }
})();
