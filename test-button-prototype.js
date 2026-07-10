/**
 * MINIMAL BUTTON PROTOTYPE
 *
 * Test MQTT Topics direkt ohne Backend-Komplexität.
 */

const mqtt = require('mqtt');

// Config
const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';
const DEVICE_ID = 'btn_9182a0';
const BASE_TOPIC = 'buttonplus';

// State
let currentPage = 1;
const buttonCount = 16;

// Connect
console.log('🔌 Connecting to MQTT...');
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => {
  console.log('✅ Connected to MQTT\n');

  // Subscribe zu allen Button-Events UND allen Topics für Debugging
  const buttonTopic = `${BASE_TOPIC}/${DEVICE_ID}/button/+/pushbutton`;
  const allButtonTopics = `${BASE_TOPIC}/${DEVICE_ID}/button/#`;
  console.log(`📡 Subscribing: ${buttonTopic}`);
  console.log(`📡 Subscribing: ${allButtonTopics} (for debugging)\n`);
  client.subscribe(buttonTopic, { qos: 0 });
  client.subscribe(allButtonTopics, { qos: 0 });

  // Initial render
  console.log('🎨 Rendering initial state...\n');
  renderPage(currentPage);
});

client.on('message', (topic, payload) => {
  const payloadStr = payload.toString();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📨 MQTT MESSAGE`);
  console.log(`   Topic:   ${topic}`);
  console.log(`   Payload: ${payloadStr}`);

  // Parse pushbutton topic
  const match = topic.match(/button\/(\d+)-(\d+)\/pushbutton$/);
  if (!match) {
    console.log(`   ℹ️  Not a pushbutton topic (other button event)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  const position = parseInt(match[1]);
  const page = parseInt(match[2]);

  console.log(`   Button:  Position ${position}, Page ${page}`);

  // Parse JSON payload
  try {
    const data = JSON.parse(payloadStr);
    console.log(`   Event:   ${data.event_type}`);

    // Nur auf shortpress reagieren
    if (data.event_type === 'shortpress') {
      console.log(`   ✓ Processing shortpress...`);
      handleButtonPress(position, page);
    } else {
      console.log(`   ⏩ Ignoring ${data.event_type}`);
    }
  } catch (e) {
    console.log(`   ❌ JSON Parse Error: ${e.message}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
});

// Button Logic
function handleButtonPress(position, page) {
  console.log(`\n🔘 handleButtonPress(position=${position}, page=${page})`);

  // Navigation buttons (1=PREV/links, 2=NEXT/rechts auf Display)
  if (position === 1) {
    console.log('   → PREV button (linker Display-Button)');
    navigateTo(currentPage - 1);
  } else if (position === 2) {
    console.log('   → NEXT button (rechter Display-Button)');
    navigateTo(currentPage + 1);
  } else {
    console.log('   → Regular button (no action defined)');
  }
}

function navigateTo(newPage) {
  if (newPage < 1 || newPage > 3) {
    console.log(`   ⚠️  Invalid page: ${newPage} (must be 1-3)`);
    return;
  }

  console.log(`   ✓ Navigating: ${currentPage} → ${newPage}`);
  currentPage = newPage;

  // Re-render
  renderPage(currentPage);
}

function renderPage(page) {
  console.log(`\n🎨 RENDERING PAGE ${page}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Display setzen
  const displayTopic = `${BASE_TOPIC}/${DEVICE_ID}/displayitem/2`;
  publish(`${displayTopic}/label/set`, `Seite ${page}`);
  publish(`${displayTopic}/value/set`, `Page ${page}`);

  // Navigation Buttons (1=prev/links, 2=next/rechts)
  const canGoPrev = page > 1;
  const canGoNext = page < 3;

  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/1/label/set`, canGoPrev ? '◀' : '');
  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/1/led/front/rgb/set`, canGoPrev ? '65280' : '16711680');
  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/1/led/front/on/set`, '1');

  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/2/label/set`, canGoNext ? '▶' : '');
  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/2/led/front/rgb/set`, canGoNext ? '65280' : '16711680');
  publish(`${BASE_TOPIC}/${DEVICE_ID}/button/2/led/front/on/set`, '1');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function publish(topic, payload) {
  console.log(`📤 PUB: ${topic} = "${payload}"`);
  client.publish(topic, String(payload), { retain: true, qos: 0 });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  client.end();
  process.exit(0);
});
