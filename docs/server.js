const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: ['https://uzoamaka1900.github.io'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable');
  process.exit(1);
}

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

const User = mongoose.models.User || mongoose.model('User', userSchema);
const LoginEvent = mongoose.models.LoginEvent || mongoose.model('LoginEvent', loginEventSchema);

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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

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

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

    const totalUsers = await User.countDocuments();
    const totalLogins = await LoginEvent.countDocuments();

    const latestUser = await User.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt');

    const latestLogin = await LoginEvent.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt');

    return res.json({
      totalUsers,
      totalLogins,
      latestUser: latestUser?.createdAt || null,
      latestLogin: latestLogin?.createdAt || null
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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database is not connected yet.' });
    }

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

    return res.json({
      registrationsByDay,
      loginsByDay
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
