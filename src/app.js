const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const { sessionMiddleware, COOKIE_NAME, parseCookie } = require('./auth');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');

const app = express();

app.use(express.json());

const db = getDb();
app.use(sessionMiddleware(db));

app.use('/api/auth', authRouter);

app.use('/api', (req, res, next) => {
  if (!req.profile) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}, apiRouter);

app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

app.get('*', (req, res) => {
  if (!req.profile) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
