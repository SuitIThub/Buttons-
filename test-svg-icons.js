/**
 * SVG ICON TEST
 *
 * Testet SVG Icons auf Buttons und Display Items
 * "Use only Tiny SVG, minimize SVG as much as possible"
 */

const mqtt = require('mqtt');

// Config
const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';
const DEVICE_ID = 'btn_9182a0';
const BASE_TOPIC = 'buttonplus';

// SVG Icons für Button+ (SVG Tiny 1.2 format)
// WICHTIG: Nur viewBox im root tag, kein xmlns!
// WICHTIG: Filled shapes mit fill Attribut, keine strokes!
const ICONS = {
  // Navigation - Filled triangles
  ARROW_LEFT: '<svg viewBox="0 0 24 24"><path fill="white" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/></svg>',
  ARROW_RIGHT: '<svg viewBox="0 0 24 24"><path fill="white" d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>',
  ARROW_UP: '<svg viewBox="0 0 24 24"><path fill="white" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z"/></svg>',
  ARROW_DOWN: '<svg viewBox="0 0 24 24"><path fill="white" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>',

  // Actions - Simple filled shapes
  PLUS: '<svg viewBox="0 0 24 24"><path fill="white" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/></svg>',
  MINUS: '<svg viewBox="0 0 24 24"><path fill="white" d="M19,13H5V11H19V13Z"/></svg>',
  CHECK: '<svg viewBox="0 0 24 24"><path fill="green" d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"/></svg>',
  CROSS: '<svg viewBox="0 0 24 24"><path fill="red" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>',

  // Home - Filled house
  HOME: '<svg viewBox="0 0 24 24"><path fill="white" d="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z"/></svg>',

  // Settings - Simplified gear
  SETTINGS: '<svg viewBox="0 0 24 24"><path fill="white" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>',

  // Bulb - Filled lightbulb
  BULB_ON: '<svg viewBox="0 0 24 24"><path fill="yellow" d="M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z"/></svg>',
  BULB_OFF: '<svg viewBox="0 0 24 24"><path fill="grey" d="M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z"/></svg>',

  // Temperature - Filled thermometer
  TEMP: '<svg viewBox="0 0 24 24"><path fill="red" d="M15,13V5A3,3 0 0,0 9,5V13A5,5 0 1,0 15,13M12,4A1,1 0 0,1 13,5V8H11V5A1,1 0 0,1 12,4Z"/></svg>',

  // Simple shapes for testing
  CIRCLE: '<svg viewBox="0 0 24 24"><circle fill="white" cx="12" cy="12" r="8"/></svg>',
  SQUARE: '<svg viewBox="0 0 24 24"><rect fill="white" x="6" y="6" width="12" height="12"/></svg>',
};

console.log('🔌 Connecting to MQTT...\n');
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT\n');

  setTimeout(() => {
    testButtonSVGs();
    setTimeout(() => {
      testDisplayItemSVGs();
    }, 2000);
  }, 500);
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
  process.exit(1);
});

function testButtonSVGs() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('BUTTON SVG ICONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const buttonTests = [
    { position: 1, page: 1, icon: 'ARROW_LEFT', label: '◀' },
    { position: 2, page: 1, icon: 'ARROW_RIGHT', label: '▶' },
    { position: 3, page: 1, icon: 'HOME', label: 'Home' },
    { position: 4, page: 1, icon: 'SETTINGS', label: 'Settings' },
    { position: 5, page: 1, icon: 'BULB_ON', label: 'Light On' },
    { position: 6, page: 1, icon: 'TEMP', label: 'Temp' },
    { position: 7, page: 1, icon: 'PLUS', label: '+' },
    { position: 8, page: 1, icon: 'MINUS', label: '-' },
  ];

  buttonTests.forEach(test => {
    const svg = ICONS[test.icon];
    const svgSize = svg.length;

    console.log(`Button ${test.position}: ${test.icon} (${svgSize} bytes)`);

    // Set SVG
    const topic = `${BASE_TOPIC}/${DEVICE_ID}/button/${test.position}-${test.page}/svg/set`;
    publish(topic, svg);

    // Set Label
    const labelTopic = `${BASE_TOPIC}/${DEVICE_ID}/button/${test.position}/label/set`;
    publish(labelTopic, test.label);

    console.log('');
  });

  console.log('✅ Button SVGs configured!\n');
}

function testDisplayItemSVGs() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DISPLAY ITEM SVG ICONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const displayTests = [
    { id: 0, icon: 'TEMP', label: 'Temperature', value: '23.5', unit: '°C' },
    { id: 1, icon: 'BULB_ON', label: 'Light Status', value: 'ON', unit: '' },
  ];

  displayTests.forEach(test => {
    const svg = ICONS[test.icon];
    const svgSize = svg.length;

    console.log(`Display Item ${test.id}: ${test.icon} (${svgSize} bytes)`);

    // Set SVG
    const svgTopic = `${BASE_TOPIC}/${DEVICE_ID}/displayitem/${test.id}/svg/set`;
    publish(svgTopic, svg);

    // Set Label
    const labelTopic = `${BASE_TOPIC}/${DEVICE_ID}/displayitem/${test.id}/label/set`;
    publish(labelTopic, test.label);

    // Set Value
    const valueTopic = `${BASE_TOPIC}/${DEVICE_ID}/displayitem/${test.id}/value/set`;
    publish(valueTopic, test.value);

    // Set Unit
    if (test.unit) {
      const unitTopic = `${BASE_TOPIC}/${DEVICE_ID}/displayitem/${test.id}/unit/set`;
      publish(unitTopic, test.unit);
    }

    console.log('');
  });

  console.log('✅ Display Item SVGs configured!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👀 Schaue auf dein Button+ Display!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Press Ctrl+C to exit\n');
}

function publish(topic, payload) {
  console.log(`   📤 ${topic.replace(BASE_TOPIC + '/' + DEVICE_ID + '/', '')}`);
  console.log(`      → ${payload.length > 50 ? payload.substring(0, 50) + '...' : payload} (${payload.length} bytes)`);
  client.publish(topic, String(payload), { retain: true, qos: 0 });
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  client.end();
  process.exit(0);
});
