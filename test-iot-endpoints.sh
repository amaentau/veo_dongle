#!/bin/bash

# Test script for IoT Hub API endpoints
# Run this to verify the BBS IoT Hub functionality

BBS_URL="https://espa-tv-app.azurewebsites.net"
TEST_DEVICE="test-device-$(date +%s)"

echo "🧪 Testing BBS IoT Hub API Endpoints"
echo "===================================="
echo

# 1. Test basic health
echo "1. Testing basic health endpoint..."
curl -s -o /dev/null -w "   Status: %{http_code}\n" "${BBS_URL}/health"
echo

# 2. Test authentication flow (we need a JWT token)
echo "2. Testing authentication flow..."
echo "   (You'll need to complete this manually in browser)"
echo "   Go to: ${BBS_URL}"
echo "   Login and get JWT token from browser dev tools"
echo

# For now, let's test the endpoints that don't require auth
echo "3. Testing public IoT Hub endpoints..."

# Test device auth token retrieval (should fail without valid device)
echo "   Testing device auth token endpoint..."
curl -s -X GET "${BBS_URL}/devices/${TEST_DEVICE}/auth-token" | jq . 2>/dev/null || echo "   (jq not available, raw response above)"

# Test IoT connection endpoint (should fail without token)
echo "   Testing IoT connection endpoint..."
curl -s -X GET "${BBS_URL}/devices/${TEST_DEVICE}/iot-connection?token=invalid" | jq . 2>/dev/null || echo "   (jq not available, raw response above)"

echo
echo "📋 Manual Testing Steps:"
echo "========================"
echo
echo "1. Open browser to: ${BBS_URL}"
echo "2. Login to get JWT token:"
echo "   - Open Dev Tools (F12)"
echo "   - Go to Application/Storage > Local Storage"
echo "   - Find 'espa_token' value"
echo
echo "3. Test device registration:"
echo "curl -X POST ${BBS_URL}/devices/${TEST_DEVICE}/register-iot \\"
echo "  -H \"Authorization: Bearer YOUR_JWT_TOKEN\""
echo
echo "4. Test IoT command sending:"
echo "curl -X POST ${BBS_URL}/devices/${TEST_DEVICE}/commands/play \\"
echo "  -H \"Authorization: Bearer YOUR_JWT_TOKEN\""
echo
echo "5. Test IoT status check:"
echo "curl -X GET ${BBS_URL}/devices/${TEST_DEVICE}/iot-status \\"
echo "  -H \"Authorization: Bearer YOUR_JWT_TOKEN\""
echo
echo "Expected Results:"
echo "- Device registration: {\"ok\":true, \"deviceId\":\"...\", \"registered\":true}"
echo "- IoT command: {\"ok\":true, \"messageId\":\"...\"}"
echo "- IoT status: Device connection status"
echo
echo "🎯 If all tests pass, the IoT Hub backend is working correctly!"
