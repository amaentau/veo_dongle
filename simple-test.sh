#!/bin/bash

echo "🧪 Simple IoT Hub API Test"
echo "=========================="

# Test 1: Basic app response
echo "1. Testing basic app response..."
curl -s -I https://espa-tv-app.azurewebsites.net/ | head -1

# Test 2: Auth lookup (should work without auth)
echo -e "\n2. Testing auth lookup..."
curl -s -X POST https://espa-tv-app.azurewebsites.net/auth/lookup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}' \
  | head -5

# Test 3: IoT Hub device registration (will fail without auth, but should not crash)
echo -e "\n3. Testing IoT device registration endpoint..."
curl -s -X POST https://espa-tv-app.azurewebsites.net/devices/test-device/register-iot \
  -H "Content-Type: application/json" \
  2>&1 | head -3

echo -e "\n✅ Tests completed. Check responses above."
