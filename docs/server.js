const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const User = mongoose.model('User', new mongoose.Schema({
  name: String,
  email: String,
  password: String
}));

const LoginLog = mongoose.model('LoginLog', new mongoose.Schema({
  email: String,
  date: { type: Date, default: Date.now }
}));

app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hash });

    res.json({ message: 'User registered and email saved' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ message: 'User not found' });
    }

    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.json({ message: 'Wrong password' });
    }

    await LoginLog.create({ email });
    res.json({ message: 'Login successful (email recorded)' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Login failed' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch users' });
  }
});

app.get('/logins', async (req, res) => {
  try {
    const logs = await LoginLog.find().sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not fetch logins' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));