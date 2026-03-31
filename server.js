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

// Update project
app.put('/api/projects/:id', (req, res) => {
  const project = stmts.getProject.get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
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

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const result = stmts.deleteProject.run(req.params.id, req.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Project not found or not yours' });
  }
  res.json({ ok: true });
});

// ============ AI: Generate Dieline from 2D Creation (gpt-image-1) ============
app.post('/api/generate-dieline', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your-openai-api-key-here') {
    return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.' });
  }

  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }

  try {
    // Convert base64 to Buffer for multipart upload
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', '根据所选图片中的主要商品包装图，进行平面展开设计，想象背后的设计，并且保留完整的正面设计，形成一个平面的artwork');
    formData.append('image[]', blob, 'input.png');
    formData.append('size', '1024x1024');
    formData.append('quality', 'high');

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

    // Return URL or base64 depending on response format
    if (imageResult.url) {
      res.json({ imageUrl: imageResult.url, type: 'image' });
    } else if (imageResult.b64_json) {
      res.json({ imageUrl: `data:image/png;base64,${imageResult.b64_json}`, type: 'image' });
    } else {
      res.status(500).json({ error: 'Unexpected response format from OpenAI' });
    }

  } catch (err) {
    console.error('Generate dieline error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
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
