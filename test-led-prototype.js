/**
 * LED TEST PROTOTYPE
 *
 * Testet alle Button-LEDs (Front + Back) mit verschiedenen Farben
 */

const mqtt = require('mqtt');

// Config
const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';
const DEVICE_ID = 'btn_9182a0';
const BASE_TOPIC = 'buttonplus';

// LED Test Config
const BUTTON_COUNT = 8; // 8 Buttons: Position 0-7 (UI zeigt als "1-8")

// Farben (Hex)
const COLORS = [
  '#FF0000', // Rot
  '#00FF00', // Grün
  '#0000FF', // Blau
  '#FFFF00', // Gelb
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
  '#FFA500', // Orange
  '#800080', // Lila
  '#FFC0CB', // Pink
  '#A52A2A', // Braun
  '#808080', // Grau
  '#FFFFFF', // Weiß
  '#FF6347', // Tomato
  '#4B0082', // Indigo
  '#FFD700', // Gold
  '#00CED1', // Dark Turquoise
];

// Connect
console.log('🔌 Connecting to MQTT...');
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT\n');
  console.log('🌈 Setting LEDs with rainbow colors...\n');

  // Warte kurz damit Connection stabil ist
  setTimeout(() => {
    setAllLEDs();
  }, 500);
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
  process.exit(1);
});

function setAllLEDs() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('LED CONFIGURATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Buttons sind 1-basiert! (1-8, nicht 0-7)
  for (let buttonId = 1; buttonId <= BUTTON_COUNT; buttonId++) {
    const frontColor = COLORS[(buttonId - 1) % COLORS.length];
    const wallColor = COLORS[(buttonId - 1 + 8) % COLORS.length]; // Offset für Back

    console.log(`Button ${buttonId.toString().padStart(2, ' ')}:`);
    console.log(`   FRONT: ${frontColor} (${hexToDecimal(frontColor)})`);
    console.log(`   BACK:  ${wallColor} (${hexToDecimal(wallColor)})`);

    // Front LED
    setLED(buttonId, 'front', frontColor, 255, true);

    // Wall LED (nicht "wall"!)
    setLED(buttonId, 'wall', wallColor, 255, true);

    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All LEDs configured!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Press Ctrl+C to exit\n');
}

/**
 * Setzt eine einzelne LED
 * WICHTIG: Button-LEDs sind PAGE-SPEZIFISCH! Format: {buttonId}-{page}
 */
function setLED(buttonId, side, color, brightness, on) {
  // LED Topics brauchen -page Suffix! (wie pushbutton Topics)
  const page = 1; // Wir testen auf Page 1
  const base = `${BASE_TOPIC}/${DEVICE_ID}/button/${buttonId}-${page}/led/${side}`;

  // RGB Farbe als DEZIMALWERT (nicht Hex!)
  const decimal = hexToDecimal(color);
  publish(`${base}/rgb/set`, String(decimal));

  // Helligkeit (0-255 laut Doku!)
  publish(`${base}/brightness/set`, String(brightness));

  // On/Off (true/false als String!)
  publish(`${base}/on/set`, on ? 'true' : 'false');
}

/**
 * Konvertiert Hex-Farbe (#RRGGBB) zu Dezimal
 */
function hexToDecimal(hex) {
  const clean = hex.replace('#', '');
  return parseInt(clean, 16);
}

function publish(topic, payload) {
  console.log(`   📤 ${topic} = "${payload}"`);
  client.publish(topic, String(payload), { retain: true, qos: 0 });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');

  // LEDs ausschalten beim Beenden (retained messages löschen!)
  console.log('💡 Turning off all LEDs (deleting retained messages)...\n');
  for (let i = 1; i <= BUTTON_COUNT; i++) {
    const base = `${BASE_TOPIC}/${DEVICE_ID}/button/${i}-1/led`;
    // Leeres retained message = löschen
    client.publish(`${base}/front/rgb/set`, '', { retain: true, qos: 0 });
    client.publish(`${base}/front/on/set`, '', { retain: true, qos: 0 });
    client.publish(`${base}/front/brightness/set`, '', { retain: true, qos: 0 });
    client.publish(`${base}/wall/rgb/set`, '', { retain: true, qos: 0 });
    client.publish(`${base}/wall/on/set`, '', { retain: true, qos: 0 });
    client.publish(`${base}/wall/brightness/set`, '', { retain: true, qos: 0 });
  }

  setTimeout(() => {
    client.end();
    process.exit(0);
  }, 500);
});
