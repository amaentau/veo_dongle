const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth-routes');
const deviceRoutes = require('./routes/device-routes').router;
const configRoutes = require('./routes/config-routes');
const entryRoutes = require('./routes/entry-routes');
const libraryRoutes = require('./routes/library-routes');
const socialRoutes = require('./routes/social-routes');
const hubRoutes = require('./routes/hub-routes').router;

const app = express();
const port = process.env.PORT || 3000;

// Basic Middleware
app.use(cors());
app.use(express.json());

// Set Cache-Control for development/debugging
app.use((req, res, next) => {
  console.log(`[DEBUG] Request: ${req.url}`);
  if (req.url.endsWith('.js') || req.url.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static files from the Svelte build output
const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');

app.use(express.static(distPath));
app.use(express.static(publicPath)); // Fallback for images like logo.png if they stay in public

// Routes
app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/config', configRoutes);
app.use('/entries', entryRoutes); // For /entries/:key
app.use('/entry', entryRoutes);   // For /entry (POST)
app.use('/library', libraryRoutes);
app.use('/social', socialRoutes);
app.use('/hubs', hubRoutes);

// Handle SPA routing - send all other requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`BBS listening on port ${port}`);
});
