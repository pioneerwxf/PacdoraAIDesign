const express = require('express');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] || '').replace(/^['"]|['"]$/g, '');
    }
  });
}

const app = express();
const PORT = process.env.PORT || 8080;

// ============ Middleware ============
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// ============ Database Setup ============
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT DEFAULT 'Untitled',
    is_demo BOOLEAN DEFAULT 0,
    packify_project_id TEXT,
    cards_data TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Prepared statements
const stmts = {
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (id) VALUES (?)'),
  getProjects: db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC'),
  getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
  getDemoProject: db.prepare('SELECT * FROM projects WHERE user_id = ? AND is_demo = 1'),
  createProject: db.prepare('INSERT INTO projects (id, user_id, name, is_demo, cards_data) VALUES (?, ?, ?, ?, ?)'),
  updateProject: db.prepare('UPDATE projects SET name = COALESCE(?, name), packify_project_id = COALESCE(?, packify_project_id), cards_data = COALESCE(?, cards_data), updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?'),
};

// ============ Helper: generate short ID ============
function shortId() {
  return uuidv4().replace(/-/g, '').substring(0, 8);
}

// ============ Demo project default cards ============
const DEMO_CARDS = JSON.stringify([
  {
    type: 'dieline',
    x: 60, y: 120,
    width: 500, height: null,
    imageSrc: 'images/mother-dairy-vanilla.png',
    mode: '2d',
    label: '# 2D Dieline'
  },
  {
    type: 'creation',
    x: 620, y: 120,
    width: 300, height: null,
    imageSrc: 'images/mother-dairy-2Dcreation.png',
    mode: '2d',
    label: '# 2D Creation'
  },
  {
    type: 'mockup',
    x: 1050, y: 120,
    width: 400, height: 500,
    iframeSrc: 'https://www.pacdora.com/share?filter_url=psre5mjuiy',
    mode: '3d',
    label: '# 3D mockup'
  }
]);

// ============ Middleware: ensure user ============
function ensureUser(req, res, next) {
  let userId = req.cookies.user_id;

  if (!userId || !stmts.getUser.get(userId)) {
    userId = uuidv4();
    stmts.createUser.run(userId);
    res.cookie('user_id', userId, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false,
      sameSite: 'lax'
    });
  }

  req.userId = userId;
  next();
}

app.use('/api', ensureUser);

// ============ API Routes ============

// List all projects for current user
app.get('/api/projects', (req, res) => {
  const projects = stmts.getProjects.all(req.userId);

  // If no projects, create demo automatically
  if (projects.length === 0) {
    const demoId = 'demo_' + shortId();
    stmts.createProject.run(demoId, req.userId, 'Demo Project', 1, DEMO_CARDS);
    const demo = stmts.getProject.get(demoId);
    return res.json([demo]);
  }

  res.json(projects);
});

// Get single project (public access for sharing — no user check)
app.get('/api/projects/:id', (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

// Create new project
app.post('/api/projects', (req, res) => {
  const id = shortId();
  const name = req.body.name || 'Untitled';
  stmts.createProject.run(id, req.userId, name, 0, '[]');
  const project = stmts.getProject.get(id);
  res.status(201).json(project);
});

// Update project (upsert — create with custom ID if not exists)
app.put('/api/projects/:id', (req, res) => {
  let project = stmts.getProject.get(req.params.id);
  if (!project) {
    // Create with the client-supplied ID (e.g. generated on frontend)
    stmts.createProject.run(req.params.id, req.userId, req.body.name || 'Untitled', 0, '[]');
    project = stmts.getProject.get(req.params.id);
  }

  const { name, packify_project_id, cards_data } = req.body;
  stmts.updateProject.run(
    name || null,
    packify_project_id || null,
    cards_data ? JSON.stringify(cards_data) : null,
    req.params.id
  );

  const updated = stmts.getProject.get(req.params.id);
  res.json(updated);
});

// Beacon endpoint for beforeunload saves (accepts text/plain body from sendBeacon)
app.post('/api/projects/:id/beacon', express.text({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let project = stmts.getProject.get(req.params.id);
    if (!project) {
      // Determine user from cookie if available
      const userId = req.cookies?.user_id || 'beacon_user';
      stmts.createProject.run(req.params.id, userId, body.name || 'Untitled', 0, '[]');
    }
    const { name, cards_data } = body;
    stmts.updateProject.run(name || null, null, cards_data ? JSON.stringify(cards_data) : null, req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(204).end(); // beacon always returns 204
  }
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const result = stmts.deleteProject.run(req.params.id, req.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Project not found or not yours' });
  }
  res.json({ ok: true });
});

// ============ Helper: resolve image to base64 (supports data URL, http URL, or raw base64) ============
async function resolveImageBase64(imageBase64, imageUrl) {
  if (imageBase64) return imageBase64;
  if (!imageUrl) return null;
  // GPT-4o can use URLs directly, but gpt-image-1 edit needs binary — fetch server-side
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'PacdoraAI/1.0' }
  });
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status}): ${imageUrl}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// ============ Helper: ensure imageResult is always returned as base64 data URL ============
// OpenAI sometimes returns a CDN URL instead of b64_json; proxy it server-side so the
// client always gets a data URL (enabling storedBase64 caching and avoiding CORS issues).
async function imageResultToDataUrl(imageResult) {
  if (imageResult.b64_json) {
    return `data:image/png;base64,${imageResult.b64_json}`;
  }
  if (imageResult.url) {
    try {
      const r = await fetch(imageResult.url, { headers: { 'User-Agent': 'PacdoraAI/1.0' } });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
      }
    } catch (e) {
      console.warn('Could not proxy image URL to base64, returning URL directly:', e.message);
    }
    return imageResult.url; // last resort
  }
  return null;
}

// ============ AI: Generate Dieline from 2D Creation (gpt-image-1) ============
app.post('/api/generate-dieline', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.' });
  }

  const { imageBase64: providedBase64, imageUrl } = req.body;
  if (!providedBase64 && !imageUrl) {
    return res.status(400).json({ error: 'imageBase64 or imageUrl is required' });
  }

  try {
    const imageBase64 = await resolveImageBase64(providedBase64, imageUrl);
    if (!imageBase64) return res.status(400).json({ error: 'Could not resolve image data' });
    // Convert base64 to Buffer for multipart upload
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', '根据所选图片中的主要商品包装图，进行平面展开设计，想象背后的设计，并且保留完整的正面设计，形成一个平面的artwork');
    formData.append('image[]', blob, 'input.png');
    formData.append('size', '1024x1024');

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI Image API error' });
    }

    const data = await response.json();
    const imageResult = data.data?.[0];

    if (!imageResult) {
      return res.status(500).json({ error: 'gpt-image-1 did not return an image' });
    }

    // Always return a data URL so the client can cache base64 without CORS issues
    const dataUrl = await imageResultToDataUrl(imageResult);
    if (!dataUrl) return res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    res.json({ imageUrl: dataUrl, type: 'image' });

  } catch (err) {
    console.error('Generate dieline error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============ AI: Edit Text on Image (gpt-image-1) ============
app.post('/api/edit-text-image', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.' });
  }

  const { imageBase64: providedBase64, imageUrl, diffs, size } = req.body;
  if (!providedBase64 && !imageUrl) {
    return res.status(400).json({ error: 'imageBase64 or imageUrl is required' });
  }
  if (!diffs || diffs.length === 0) {
    return res.status(400).json({ error: 'No text changes provided' });
  }
  // Validate size (OpenAI gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024, auto)
  const validSizes = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  const imageSize = validSizes.includes(size) ? size : '1024x1024';

  // Build prompt: instruct AI to only change specified text, keep everything else identical
  const changeInstructions = diffs.map(d => {
    const textChange = d.changes.find(c => c.field === 'text');
    const styleChanges = d.changes.filter(c => c.field !== 'text');
    let instruction = '';
    if (textChange) {
      instruction += `Change the text "${textChange.from}" to "${textChange.to}"`;
    }
    if (styleChanges.length > 0) {
      const styleParts = styleChanges.map(c => {
        if (c.field === 'font') return `change font to ${c.to}`;
        if (c.field === 'size') return `change font size to ${c.to}`;
        if (c.field === 'align') return `change alignment to ${c.to}`;
        return '';
      }).filter(Boolean);
      if (styleParts.length > 0) {
        instruction += (instruction ? ', and ' : 'For "' + d.label + '": ') + styleParts.join(', ');
      }
    }
    return instruction;
  }).join('. ');

  const prompt = `You are editing a packaging design image. This is a STRICT text replacement task.

CRITICAL RULES:
- Keep the EXACT same layout, composition, dimensions, and aspect ratio
- Keep the EXACT same background, colors, gradients, and textures
- Keep the EXACT same logos, icons, images, illustrations, and decorative elements
- Keep the EXACT same font style and visual appearance for unchanged text
- ONLY replace the specific text characters as instructed below
- The text position, size, and styling should remain in the same location

Text changes to make:
${changeInstructions}

Everything else in the image must remain PIXEL-PERFECT identical to the original. Only the specified text characters should change.`;

  try {
    const imageBase64 = await resolveImageBase64(providedBase64, imageUrl);
    if (!imageBase64) return res.status(400).json({ error: 'Could not resolve image data' });

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('image[]', blob, 'input.png');
    formData.append('size', imageSize);

    console.log(`Calling OpenAI gpt-image-1 edit, size=${imageSize}, prompt length=${prompt.length}`);

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', err);
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI Image API error' });
    }

    const data = await response.json();
    const imageResult = data.data?.[0];

    if (!imageResult) {
      return res.status(500).json({ error: 'gpt-image-1 did not return an image' });
    }

    const dataUrl = await imageResultToDataUrl(imageResult);
    if (!dataUrl) return res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    res.json({ imageUrl: dataUrl, type: 'image' });

  } catch (err) {
    console.error('Edit text image error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============ AI: Pin-based Image Edit (gpt-image-1) ============
app.post('/api/pin-edit-image', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured.' });
  }

  const { imageBase64: providedBase64Pin, imageUrl: imageUrlPin, description, pins, size } = req.body;
  if (!providedBase64Pin && !imageUrlPin) return res.status(400).json({ error: 'imageBase64 or imageUrl is required' });
  if (!description) return res.status(400).json({ error: 'description is required' });

  const validSizes = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  const imageSize = validSizes.includes(size) ? size : '1024x1024';

  // Build pin location context
  let pinContext = '';
  if (pins && pins.length > 0) {
    pinContext = `The user has placed ${pins.length} pin(s) on specific areas of the image to indicate where changes should be made. Pin locations (as percentage from top-left): ${pins.map(p => `Pin #${p.pinId} at (${p.x}%, ${p.y}%)`).join(', ')}. `;
  }

  const prompt = `You are editing a packaging design image. ${pinContext}

The user's modification request: "${description}"

CRITICAL RULES:
- Keep the EXACT same layout, composition, dimensions, and aspect ratio
- Keep ALL elements that are NOT mentioned in the user's request COMPLETELY unchanged
- Only modify what the user specifically asked for
- Preserve all logos, icons, barcodes, certification marks, and decorative elements exactly as they are
- The overall design style, color scheme, and visual identity must remain identical
- Focus the changes on the area(s) indicated by the pin(s)

Apply the user's requested changes while keeping everything else pixel-perfect identical.`;

  try {
    const imageBase64 = await resolveImageBase64(providedBase64Pin, imageUrlPin);
    if (!imageBase64) return res.status(400).json({ error: 'Could not resolve image data' });

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('image[]', blob, 'input.png');
    formData.append('size', imageSize);

    console.log(`Calling OpenAI pin-edit, size=${imageSize}, pins=${pins?.length || 0}, desc="${description.substring(0, 50)}..."`);

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', err);
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI Image API error' });
    }

    const data = await response.json();
    const imageResult = data.data?.[0];
    if (!imageResult) return res.status(500).json({ error: 'No image returned' });

    const dataUrl = await imageResultToDataUrl(imageResult);
    if (!dataUrl) return res.status(500).json({ error: 'Unexpected response format' });
    res.json({ imageUrl: dataUrl, type: 'image' });
  } catch (err) {
    console.error('Pin edit image error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============ AI: Extract Text from Image (GPT-4o Vision) ============
app.post('/api/extract-text', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured.' });
  }

  const { imageBase64, imageUrl } = req.body;
  if (!imageBase64 && !imageUrl) return res.status(400).json({ error: 'imageBase64 or imageUrl is required' });

  // Build image content for GPT-4o: prefer base64 data URL, fallback to direct URL
  const imageContent = imageBase64
    ? { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
    : { type: 'image_url', image_url: { url: imageUrl } };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a packaging text extractor. Analyze the image and extract ALL visible text. Return a JSON array where each item has:
- "label": category name in English (e.g. "Brand Name", "Product Type", "Tagline", "Ingredients", "Nutrition Info", "Barcode Text", "Social Media", "Legal Text", "Instructions", etc.)
- "text": the exact text content as shown on the image
- "font": best guess of font style, one of "serif", "sans-serif", "monospace", "cursive"
- "size": estimated relative font size as a number (larger text = higher number, range 8-48)
- "align": text alignment, one of "left", "center", "right"

Be thorough - extract EVERY piece of visible text including small print, numbers, URLs, social media handles. Return ONLY the JSON array, no markdown.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all visible text from this packaging design image.' },
              imageContent
            ]
          }
        ],
        max_tokens: 3000
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('GPT-4o text extraction error:', err);
      return res.status(response.status).json({ error: err.error?.message || 'Vision API error' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    let texts;
    try {
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      texts = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse text JSON:', content);
      return res.status(500).json({ error: 'Failed to parse AI response', raw: content });
    }

    res.json({ texts });
  } catch (err) {
    console.error('Extract text error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============ AI: Extract Elements from Image (GPT-4o Vision) ============
app.post('/api/extract-elements', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured.' });
  }

  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a packaging design analyst. Analyze the image and extract ALL visual elements. Return a JSON array of elements. Each element must have:
- "label": short name (e.g. "Brand Logo", "Product Photo")
- "type": one of "logo", "text", "illustration", "photo", "icon", "pattern", "background", "barcode", "badge", "decoration"
- "desc": brief description of the element
- "position": approximate position as "top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"

Include the background as the first element. Be thorough - extract every distinct visual element including small icons, certification marks, QR codes, decorative patterns, etc. Return ONLY the JSON array, no markdown.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all visual elements from this packaging design image.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
            ]
          }
        ],
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('GPT-4o Vision error:', err);
      return res.status(response.status).json({ error: err.error?.message || 'Vision API error' });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';

    // Parse the JSON response
    let elements;
    try {
      // Strip markdown code block if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      elements = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse elements JSON:', content);
      return res.status(500).json({ error: 'Failed to parse AI response', raw: content });
    }

    res.json({ elements });

  } catch (err) {
    console.error('Extract elements error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ============ Dashboard Stats API (no auth required) ============
app.get('/api/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT count(*) as n FROM users').get().n;
  const totalProjects = db.prepare('SELECT count(*) as n FROM projects').get().n;
  const realProjects = db.prepare("SELECT count(*) as n FROM projects WHERE is_demo = 0").get().n;
  const demoProjects = db.prepare("SELECT count(*) as n FROM projects WHERE is_demo = 1").get().n;

  // Users registered per day (last 30 days)
  const usersByDay = db.prepare(`
    SELECT date(created_at) as day, count(*) as count
    FROM users
    WHERE created_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();

  // Projects created per day (last 30 days)
  const projectsByDay = db.prepare(`
    SELECT date(created_at) as day, count(*) as count
    FROM projects
    WHERE created_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day
  `).all();

  // Projects updated per day (last 30 days)
  const projectsUpdatedByDay = db.prepare(`
    SELECT date(updated_at) as day, count(*) as count
    FROM projects
    WHERE updated_at >= date('now', '-30 days') AND is_demo = 0
    GROUP BY day ORDER BY day
  `).all();

  // Card counts per project
  const projectsData = db.prepare('SELECT id, name, cards_data, created_at, updated_at, is_demo FROM projects ORDER BY updated_at DESC').all();
  const projectStats = projectsData.map(p => {
    let cards = [];
    try { const parsed = JSON.parse(p.cards_data || '[]'); cards = Array.isArray(parsed) ? parsed : []; } catch(e) {}
    const cardTypes = {};
    cards.forEach(c => { cardTypes[c.type || 'unknown'] = (cardTypes[c.type || 'unknown'] || 0) + 1; });
    return { id: p.id, name: p.name, cardCount: cards.length, cardTypes, created_at: p.created_at, updated_at: p.updated_at, is_demo: p.is_demo };
  });

  // Total cards
  const totalCards = projectStats.reduce((sum, p) => sum + p.cardCount, 0);
  const cardTypeTotal = {};
  projectStats.forEach(p => {
    Object.entries(p.cardTypes).forEach(([t, n]) => { cardTypeTotal[t] = (cardTypeTotal[t] || 0) + n; });
  });

  res.json({
    summary: { totalUsers, totalProjects, realProjects, demoProjects, totalCards },
    usersByDay,
    projectsByDay,
    projectsUpdatedByDay,
    projectStats,
    cardTypeTotal
  });
});

// ============ Static Files ============
app.use(express.static(path.join(__dirname)));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ Start ============
app.listen(PORT, () => {
  console.log(`Pacdora AI Design server running on http://localhost:${PORT}`);
});
