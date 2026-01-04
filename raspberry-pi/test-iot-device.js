#!/usr/bin/env node

/**
 * Test script for Raspberry Pi IoT Hub device functionality
 * Run this to test the IoT device service integration
 */

const IoTDeviceService = require('./src/iot-device-service');

// Mock player for testing
class MockPlayer {
  async playStream() {
    console.log('🎬 [MOCK] Playing stream');
    return { success: true, message: 'Stream started' };
  }

  async pauseStream() {
    console.log('⏸️ [MOCK] Pausing stream');
    return { success: true, message: 'Stream paused' };
  }

  async toggleFullscreen() {
    console.log('🔄 [MOCK] Toggling fullscreen');
    return { success: true, message: 'Fullscreen toggled' };
  }
}

async function testIoTDeviceService() {
  console.log('🧪 Testing Raspberry Pi IoT Hub Device Service');
  console.log('=============================================');

  // Test 1: Mock connection string (no real IoT Hub)
  console.log('\n1. Testing with mock connection string:');

  const mockConnectionString = 'HostName=espa-tv-iot-hub.azure-devices.net;DeviceId=test-device;SharedAccessKey=bW9ja2tleQ==';
  const mockPlayer = new MockPlayer();

  const iotService = new IoTDeviceService('test-device', mockConnectionString);

  // Set up command handler
  iotService.onCommand(async (command, payload) => {
    console.log(`📨 [MOCK] Handling command: ${command}`, payload || '');

    switch (command) {
      case 'play':
        return await mockPlayer.playStream();
      case 'pause':
        return await mockPlayer.pauseStream();
      case 'fullscreen':
        return await mockPlayer.toggleFullscreen();
      case 'status':
        return { success: true, status: { deviceId: 'test-device', mock: true } };
      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  });

  // Try to connect (will fail gracefully without real IoT Hub)
  try {
    const connected = await iotService.connect();
    console.log('🔗 Connection attempt result:', connected ? 'SUCCESS' : 'FAILED (expected without real IoT Hub)');
  } catch (error) {
    console.log('🔗 Connection failed (expected):', error.message);
  }

  // Test command handling directly
  console.log('\n2. Testing command handling:');

  const commands = [
    { command: 'play', payload: null },
    { command: 'pause', payload: null },
    { command: 'fullscreen', payload: null },
    { command: 'status', payload: null },
    { command: 'unknown', payload: null }
  ];

  for (const cmd of commands) {
    try {
      const result = await iotService.onCommandCallback(cmd.command, cmd.payload);
      console.log(`✅ Command "${cmd.command}" result:`, result);
    } catch (error) {
      console.log(`❌ Command "${cmd.command}" failed:`, error.message);
    }
  }

  // Test status
  console.log('\n3. Testing service status:');
  const status = iotService.getStatus();
  console.log('📊 Service status:', status);

  // Cleanup
  await iotService.disconnect();

  console.log('\n🎉 Raspberry Pi IoT Device Service test completed!');
  console.log('\n📋 Next Steps:');
  console.log('1. Register your Raspberry Pi device with the BBS using the IoT Hub registration endpoint');
  console.log('2. Deploy this code to your Raspberry Pi');
  console.log('3. The device will automatically connect to IoT Hub and receive commands');
  console.log('4. Test sending commands from the BBS to your device');
}

// Run the test
testIoTDeviceService().catch(console.error);
