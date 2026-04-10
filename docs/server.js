const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: ['https://uzoamaka1900.github.io'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_KEY = process.env.ADMIN_KEY;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable');
  process.exit(1);
}

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error('Missing GitHub environment variables: GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

// MODELS
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true }
);

const loginEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true }
);

const contributionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ['Story', 'Media', 'Record']
    },
    collection: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    contributorName: { type: String, required: true, trim: true },
    contributorEmail: { type: String, required: true, lowercase: true, trim: true },

    filename: { type: String, default: '', trim: true },
    originalFilename: { type: String, default: '', trim: true },
    mimeType: { type: String, default: '', trim: true },
    size: { type: Number, default: 0 },

    githubPath: { type: String, default: '', trim: true },
    githubUrl: { type: String, default: '', trim: true },
    githubSha: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending'
    },

    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    adminNotes: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);
const LoginEvent = mongoose.models.LoginEvent || mongoose.model('LoginEvent', loginEventSchema);
const Contribution = mongoose.models.Contribution || mongoose.model('Contribution', contributionSchema);

// HELPERS
function createToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];

  if (!ADMIN_KEY) {
    return res.status(500).json({ message: 'ADMIN_KEY is not configured.' });
  }

  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(403).json({ message: 'Forbidden.' });
  }

  next();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      email: decoded.email
    };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function ensureDatabaseConnected(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ message: 'Database is not connected yet.' });
    return false;
  }
  return true;
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function sanitizeFilename(value = '') {
  return String(value)
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getTypeFolder(type) {
  if (type === 'Story') return 'stories';
  if (type === 'Media') return 'media';
  return 'records';
}

function buildGithubPath({ type, collection, originalFilename }) {
  const folder = getTypeFolder(type);
  const collectionSlug = slugify(collection || 'general');
  const timestamp = Date.now();
  const cleanName = sanitizeFilename(originalFilename || 'upload.bin');
  return `uploads/${folder}/${collectionSlug}/${timestamp}-${cleanName}`;
}

async function uploadFileToGitHub({ path, contentBuffer, message }) {
  const content = contentBuffer.toString('base64');

  const response = await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path,
    message,
    content,
    branch: GITHUB_BRANCH
  });

  const githubUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;

  return {
    sha: response.data.content.sha,
    path,
    githubUrl
  };
}

async function deleteFileFromGitHub({ path, sha, message }) {
  if (!path || !sha) return;

  await octokit.repos.deleteFile({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path,
    message,
    sha,
    branch: GITHUB_BRANCH
  });
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map(tag => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean);
  }

  return [];
}

// ROUTES
app.get('/', (req, res) => {
  res.json({ message: 'WITH Commons backend is running' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/db-status', (req, res) => {
  res.json({
    readyState: mongoose.connection.readyState
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash
    });

    const token = createToken(user);

    await LoginEvent.create({
      userId: user._id,
      email: user.email,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || ''
    });

    return res.status(201).json({
      message: 'Registration successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      message: error.message || 'Server error during registration.'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = createToken(user);

    await LoginEvent.create({
      userId: user._id,
      email: user.email,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || ''
    });

    return res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      message: error.message || 'Server error during login.'
    });
  }
});

app.get('/api/auth/users', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const users = await User.find()
      .select('name email createdAt')
      .sort({ createdAt: -1 });

    return res.json(users);
  } catch (error) {
    console.error('Fetch users error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch users.'
    });
  }
});

app.get('/api/auth/logins', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const logins = await LoginEvent.find()
      .select('email ipAddress userAgent createdAt')
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json(logins);
  } catch (error) {
    console.error('Fetch logins error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch login events.'
    });
  }
});

// CONTRIBUTIONS
app.post('/api/contributions', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const {
      title,
      description,
      type,
      collection,
      tags = [],
      contributorName,
      contributorEmail
    } = req.body;

    if (!title || !description || !type || !collection || !contributorName || !contributorEmail) {
      return res.status(400).json({
        message: 'Title, description, type, collection, contributor name, and contributor email are required.'
      });
    }

    if (!['Story', 'Media', 'Record'].includes(type)) {
      return res.status(400).json({
        message: 'Type must be Story, Media, or Record.'
      });
    }

    let githubUpload = {
      path: '',
      sha: '',
      githubUrl: ''
    };

    if (req.file) {
      const githubPath = buildGithubPath({
        type,
        collection,
        originalFilename: req.file.originalname
      });

      githubUpload = await uploadFileToGitHub({
        path: githubPath,
        contentBuffer: req.file.buffer,
        message: `Add contribution file: ${title.trim()}`
      });
    }

    const contribution = await Contribution.create({
      title: title.trim(),
      description: description.trim(),
      type,
      collection: collection.trim(),
      tags: normalizeTags(tags),
      contributorName: contributorName.trim(),
      contributorEmail: contributorEmail.toLowerCase().trim(),

      filename: req.file ? sanitizeFilename(req.file.originalname) : '',
      originalFilename: req.file ? req.file.originalname : '',
      mimeType: req.file ? req.file.mimetype : '',
      size: req.file ? req.file.size : 0,

      githubPath: githubUpload.path,
      githubUrl: githubUpload.githubUrl,
      githubSha: githubUpload.sha,

      submittedBy: req.user.userId
    });

    return res.status(201).json({
      message: 'Contribution submitted successfully.',
      contribution
    });
  } catch (error) {
    console.error('Create contribution error:', error);
    return res.status(500).json({
      message: error.message || 'Could not submit contribution.'
    });
  }
});

app.get('/api/contributions/mine', requireAuth, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const contributions = await Contribution.find({ submittedBy: req.user.userId })
      .sort({ createdAt: -1 });

    return res.json(contributions);
  } catch (error) {
    console.error('Fetch my contributions error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch your contributions.'
    });
  }
});

app.get('/api/contributions', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const contributions = await Contribution.find()
      .sort({ createdAt: -1 });

    return res.json(contributions);
  } catch (error) {
    console.error('Fetch contributions error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch contributions.'
    });
  }
});

// PUBLIC ROUTE FOR SITE DISPLAY
app.get('/api/public/contributions', async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const { type, collection, limit } = req.query;

    const query = { status: 'Approved' };

    if (type && ['Story', 'Media', 'Record'].includes(type)) {
      query.type = type;
    }

    if (collection) {
      query.collection = String(collection).trim();
    }

    const safeLimit = Math.min(Number(limit) || 100, 200);

    const contributions = await Contribution.find(query)
      .select('-githubSha -adminNotes')
      .sort({ createdAt: -1 })
      .limit(safeLimit);

    return res.json(contributions);
  } catch (error) {
    console.error('Fetch public contributions error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch public contributions.'
    });
  }
});

app.patch('/api/contributions/:id/status', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const { id } = req.params;
    const { status, adminNotes = '' } = req.body;

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({
        message: 'Status must be Pending, Approved, or Rejected.'
      });
    }

    const updated = await Contribution.findByIdAndUpdate(
      id,
      {
        status,
        adminNotes: String(adminNotes || '').trim()
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: 'Contribution not found.' });
    }

    return res.json({
      message: 'Contribution updated successfully.',
      contribution: updated
    });
  } catch (error) {
    console.error('Update contribution status error:', error);
    return res.status(500).json({
      message: error.message || 'Could not update contribution.'
    });
  }
});

app.delete('/api/contributions/:id', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const deleted = await Contribution.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: 'Contribution not found.' });
    }

    try {
      if (deleted.githubPath && deleted.githubSha) {
        await deleteFileFromGitHub({
          path: deleted.githubPath,
          sha: deleted.githubSha,
          message: `Delete contribution file: ${deleted.title}`
        });
      }
    } catch (githubError) {
      console.error('GitHub delete warning:', githubError.message);
    }

    return res.json({ message: 'Contribution deleted successfully.' });
  } catch (error) {
    console.error('Delete contribution error:', error);
    return res.status(500).json({
      message: error.message || 'Could not delete contribution.'
    });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const totalUsers = await User.countDocuments();
    const totalLogins = await LoginEvent.countDocuments();
    const totalContributions = await Contribution.countDocuments();
    const pendingContributions = await Contribution.countDocuments({ status: 'Pending' });

    const latestUser = await User.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt');

    const latestLogin = await LoginEvent.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt');

    const latestContribution = await Contribution.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt');

    return res.json({
      totalUsers,
      totalLogins,
      totalContributions,
      pendingContributions,
      latestUser: latestUser?.createdAt || null,
      latestLogin: latestLogin?.createdAt || null,
      latestContribution: latestContribution?.createdAt || null
    });
  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch stats.'
    });
  }
});

app.get('/api/admin/charts', requireAdmin, async (req, res) => {
  try {
    if (!ensureDatabaseConnected(res)) return;

    const registrationsByDay = await User.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const loginsByDay = await LoginEvent.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const contributionsByDay = await Contribution.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return res.json({
      registrationsByDay,
      loginsByDay,
      contributionsByDay
    });
  } catch (error) {
    console.error('Charts error:', error);
    return res.status(500).json({
      message: error.message || 'Could not fetch chart data.'
    });
  }
});

// START SERVER FIRST
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// CONNECT DATABASE
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((error) => {
    console.error('Database connection error:', error.message);
  });
