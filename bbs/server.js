const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth-routes');
const deviceRoutes = require('./routes/device-routes').router;
const configRoutes = require('./routes/config-routes');
const entryRoutes = require('./routes/entry-routes');

const app = express();
const port = process.env.PORT || 3000;

// Basic Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/config', configRoutes);
app.use('/entries', entryRoutes); // For /entries/:key
app.use('/entry', entryRoutes);   // For /entry (POST)

app.listen(port, () => {
  console.log(`BBS listening on port ${port}`);
});
