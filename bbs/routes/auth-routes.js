const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { getTableClient, isFirstUser, TABLE_NAME_USERS } = require('../services/storage-service');
const { JWT_SECRET } = require('../middleware/auth');

const BREVO_SMTP_KEY = process.env.BREVO_SMTP_KEY;
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER;
const BREVO_SMTP_HOST = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
const BREVO_SMTP_PORT = parseInt(process.env.BREVO_SMTP_PORT) || 587;
const FROM_EMAIL = (process.env.FROM_EMAIL || 'noreply@espa-tv.com').trim();
const FROM_NAME = (process.env.FROM_NAME || 'Espa TV Auth').trim();

// Setup Nodemailer Transporter
let mailTransporter = null;
if (BREVO_SMTP_KEY && BREVO_SMTP_USER) {
  mailTransporter = nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: BREVO_SMTP_PORT,
    secure: false,
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_KEY,
    },
  });
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to, subject, text) {
  if (!mailTransporter) {
    console.log(`[MOCK EMAIL] To: ${to} | Subject: ${subject} | Body: ${text}`);
    return;
  }
  
  try {
    await mailTransporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      text,
      html: `<strong>${text}</strong>`,
    });
    console.log(`📧 Email sent to ${to}`);
  } catch (error) {
    console.error('❌ SMTP Error:', error);
    throw new Error('Email sending failed');
  }
}

// 1. Lookup
router.post('/lookup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const user = await client.getEntity(email, 'profile');
    return res.json({ exists: true, isAdmin: !!user.isAdmin });
  } catch (err) {
    if (err.statusCode === 404) return res.json({ exists: false });
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// 2. Send OTP
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const otp = generateOTP();
  const expires = Date.now() + 10 * 60 * 1000; 

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    await client.upsertEntity({
      partitionKey: email,
      rowKey: 'otp',
      code: otp,
      expires
    });

    await sendEmail(email, 'ESPA TV: Vahvistuskoodisi', `Tervetuloa ESPA TV -palveluun. Vahvistuskoodisi on: ${otp}`);
    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    console.error('Send OTP error:', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// 3. Verify OTP
router.post('/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const otpEntity = await client.getEntity(email, 'otp');

    if (!otpEntity || String(otpEntity.code) !== String(code)) {
      return res.status(401).json({ error: 'Invalid code' });
    }
    if (Date.now() > otpEntity.expires) {
      return res.status(401).json({ error: 'Code expired' });
    }

    const setupToken = jwt.sign({ email, purpose: 'setup' }, JWT_SECRET, { expiresIn: '15m' });
    await client.deleteEntity(email, 'otp');

    return res.json({ ok: true, setupToken });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// 4. Set PIN
router.post('/set-pin', async (req, res) => {
  const { pin, setupToken } = req.body;
  if (!pin || !setupToken) return res.status(400).json({ error: 'Missing fields' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });

  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    if (decoded.purpose !== 'setup') return res.status(403).json({ error: 'Invalid token purpose' });

    const email = decoded.email;
    const pinHash = await bcrypt.hash(pin, 10);

    const client = getTableClient(TABLE_NAME_USERS);
    const makeAdmin = await isFirstUser();

    await client.upsertEntity({
      partitionKey: email,
      rowKey: 'profile',
      pinHash,
      isAdmin: makeAdmin,
      failedAttempts: 0,
      lockedUntil: 0
    });

    const token = jwt.sign({ email, isAdmin: makeAdmin }, JWT_SECRET, { expiresIn: '180d' });
    return res.json({ ok: true, token, email, isAdmin: makeAdmin });

  } catch (err) {
    console.error('Set PIN error:', err);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
});

// 5. Login
router.post('/login', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Missing fields' });

  try {
    const client = getTableClient(TABLE_NAME_USERS);
    const user = await client.getEntity(email, 'profile');

    if (user.lockedUntil && Date.now() < user.lockedUntil) {
      const waitMinutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Account locked. Try again in ${waitMinutes} minutes.` });
    }

    const match = await bcrypt.compare(pin, user.pinHash);
    
    if (!match) {
      const attempts = (user.failedAttempts || 0) + 1;
      let lockedUntil = user.lockedUntil || 0;
      if (attempts >= 3) lockedUntil = Date.now() + 15 * 60 * 1000;

      await client.updateEntity({
        partitionKey: email,
        rowKey: 'profile',
        failedAttempts: attempts,
        lockedUntil: lockedUntil
      }, "Merge");

      return res.status(401).json({ error: attempts >= 3 ? 'Locked. Too many failed attempts.' : 'Invalid PIN' });
    }

    // Success
    if (user.failedAttempts > 0) {
      await client.updateEntity({ partitionKey: email, rowKey: 'profile', failedAttempts: 0, lockedUntil: 0 }, "Merge");
    }

    const token = jwt.sign({ email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '180d' });
    return res.json({ ok: true, token, email, isAdmin: !!user.isAdmin });

  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'User not found' });
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;

