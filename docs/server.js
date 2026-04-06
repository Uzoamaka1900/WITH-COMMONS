
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// DATABASE
mongoose.connect('mongodb://127.0.0.1:27017/with_commons')
  .then(()=>console.log("MongoDB connected"));

// USER MODEL
const User = mongoose.model('User', new mongoose.Schema({
  name: String,
  email: String,
  password: String
}));

// LOGIN LOG MODEL
const LoginLog = mongoose.model('LoginLog', new mongoose.Schema({
  email: String,
  date: { type: Date, default: Date.now }
}));

// REGISTER
app.post('/register', async (req,res)=>{
  const {name,email,password} = req.body;

  const hash = await bcrypt.hash(password,10);

  await User.create({name,email,password:hash});

  res.json({message:"User registered and email saved"});
});

// LOGIN
app.post('/login', async (req,res)=>{
  const {email,password} = req.body;

  const user = await User.findOne({email});

  if(!user) return res.json({message:"User not found"});

  const ok = await bcrypt.compare(password,user.password);

  if(!ok) return res.json({message:"Wrong password"});

  // SAVE LOGIN EVENT
  await LoginLog.create({email});

  res.json({message:"Login successful (email recorded)"});
});

// VIEW USERS
app.get('/users', async (req,res)=>{
  const users = await User.find();
  res.json(users);
});

// VIEW LOGINS
app.get('/logins', async (req,res)=>{
  const logs = await LoginLog.find().sort({date:-1});
  res.json(logs);
});

app.listen(5000, ()=>console.log("Server running on 5000"));