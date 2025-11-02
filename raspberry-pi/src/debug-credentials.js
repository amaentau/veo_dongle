#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

console.log('=== Debug Credentials Loading (from src directory) ===');
console.log('Current working directory:', process.cwd());
console.log('__dirname (from src/index.js):', __dirname);

// This EXACTLY mimics the loadCredentials method in src/index.js
const credentialsPath = path.join(__dirname, '..', 'credentials.json');
console.log('Calculated credentials path:', credentialsPath);
console.log('Resolved absolute path:', path.resolve(credentialsPath));
console.log('File exists at calculated path:', fs.existsSync(credentialsPath));

// Check if the file exists where we expect it
const expectedPath = path.join(__dirname, '..', 'credentials.json');
console.log('Expected path:', expectedPath);
console.log('File exists at expected path:', fs.existsSync(expectedPath));

// List files in the parent directory
const parentDir = path.join(__dirname, '..');
console.log('Parent directory contents:');
try {
  const files = fs.readdirSync(parentDir);
  console.log(files);
} catch (err) {
  console.error('Error reading parent directory:', err.message);
}

if (fs.existsSync(credentialsPath)) {
  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    console.log('✅ Credentials loaded successfully');
    console.log('Email:', credentials.email ? '***' + credentials.email.slice(-10) : 'undefined');
    console.log('Password exists:', !!credentials.password);
  } catch (error) {
    console.error('❌ Error parsing credentials:', error.message);
  }
} else {
  console.log('❌ Credentials file not found at expected location');

  // Try alternative locations
  const altPaths = [
    path.join(process.cwd(), 'credentials.json'),
    path.join(process.cwd(), '..', 'credentials.json'),
    path.join(__dirname, 'credentials.json'),
    './credentials.json'
  ];

  console.log('\nTrying alternative paths:');
  altPaths.forEach(altPath => {
    const exists = fs.existsSync(altPath);
    console.log(`${altPath}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
    if (exists) {
      try {
        const creds = JSON.parse(fs.readFileSync(altPath, 'utf8'));
        console.log('  ✅ Successfully loaded from:', altPath);
        console.log('  Email:', creds.email ? '***' + creds.email.slice(-10) : 'undefined');
      } catch (e) {
        console.log('  ❌ Error reading from:', altPath, e.message);
      }
    }
  });
}

