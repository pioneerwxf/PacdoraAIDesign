/* ============================================
   Pacdora AI Design - Application Logic
   ============================================ */

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
  document.querySelectorAll('.design-card.selected').forEach(c => c.classList.remove('selected'));
  if (card) {
    card.classList.add('selected');
    // Focus canvas viewport so keyboard shortcuts (Delete, Copy, etc.) work
    canvasViewport.focus({ preventScroll: true });
  }
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

function newProject() {
  // TODO: implement project creation UI
  document.querySelector('.project-name').textContent = 'New Project';
}

function deleteProject() {
  if (confirm('Delete this project?')) {
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
        <span class="card-toolbar-link" onclick="event.stopPropagation();">2D Dieline</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation();">3D mockup</span>
        <span class="card-toolbar-sep">|</span>
        <span class="card-toolbar-link" onclick="event.stopPropagation();">Edit text</span>
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

  canvasContent.appendChild(card);
  applyZoom();

  // Pan canvas to reveal the new card
  panToReveal(spot.x + NEW_CARD_W / 2, spot.y + NEW_CARD_H / 2);
}

// Pin placement is now handled by the pin-mode click handler below

function generateDieline(el) {
  addSystemMessage('Matching your design to the best dieline template from Pacdora mockup library...');
  setTimeout(() => {
    const card = document.createElement('div');
    card.className = 'design-card';
    card.style.left = '60px';
    card.style.top = '520px';
    card.setAttribute('data-type', 'dieline');

    card.innerHTML = `
      <div class="card-body dieline-card" ondblclick="openDielineEditor()">
        <div class="card-toolbar">
          <div class="card-toolbar-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M4 6l4-4 4 4" stroke="#7C3AED" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="card-toolbar-link">Edit Text</span>
          <span class="card-toolbar-sep">|</span>
          <span class="card-toolbar-link">Edit Elements</span>
          <span class="card-toolbar-sep">|</span>
          <span class="card-toolbar-link">Mockup</span>
          <span class="card-toolbar-sep">|</span>
          <button class="card-download-btn">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v8M4 7l3 3 3-3M3 11h8" stroke="#333" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="card-label"># 2D Dieline</div>
        <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=400&fit=crop" alt="2D Dieline" class="card-image">
        <div class="resize-handle tl"></div><div class="resize-handle tr"></div><div class="resize-handle bl"></div><div class="resize-handle br"></div><div class="resize-handle tm"></div><div class="resize-handle bm"></div><div class="resize-handle ml"></div><div class="resize-handle mr"></div>
      </div>
    `;

    canvasContent.appendChild(card);
    addSystemMessage('Your 2D Dieline is ready! Double-click to open the editor and customize.');
  }, 2000);
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

  currentToolMode = mode;
  document.querySelectorAll('.bottom-tool-btn').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
  canvasViewport.style.cursor = mode === 'pin' ? 'crosshair' : 'grab';
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

  if (mode === '3d') {
    // Switch to 3D: replace image with iframe
    const img = cardBody.querySelector('.card-image');
    if (img) {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.pacdora.com/share?filter_url=psre5mjuiy';
      iframe.className = 'mockup-iframe';
      iframe.frameBorder = '0';
      iframe.allowFullscreen = true;
      img.replaceWith(iframe);
      // Update label & border
      const label = cardBody.querySelector('.card-label');
      if (label) { label.textContent = '# 3D mockup'; label.className = 'card-label mockup-label'; }
      cardBody.classList.remove('dieline-card', 'creation-card');
      cardBody.classList.add('mockup-card');
      // Keep same width, set height for iframe
      cardBody.style.width = currentW + 'px';
      cardBody.style.height = Math.round(currentW * 1.25) + 'px';
    }
  } else {
    // Switch to 2D: replace iframe with image
    const iframe = cardBody.querySelector('.mockup-iframe');
    if (iframe) {
      const img = document.createElement('img');
      img.src = 'images/mother-dairy-vanilla.png';
      img.alt = '2D Dieline';
      img.className = 'card-image';
      iframe.replaceWith(img);
      // Update label & border
      const label = cardBody.querySelector('.card-label');
      if (label) { label.textContent = '# 2D Dieline'; label.className = 'card-label'; }
      cardBody.classList.remove('mockup-card', 'creation-card');
      cardBody.classList.add('dieline-card');
      // Let image determine height naturally
      cardBody.style.width = currentW + 'px';
      cardBody.style.height = '';
    }
  }
  applyZoom();
}

function editText(type) {
  // Placeholder
}

function editElements(type) {
  // Placeholder
}

function showMockup(type) {
  // Placeholder
}

function downloadCard(type) {
  // Placeholder
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
    x = Math.max(0, x);
    y = Math.max(0, y);

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

// ============ Init ============
applyZoom();
