/**
 * MINIMAL LED TEST - Genau 1 LED wie im funktionierenden Prototyp
 */

const mqtt = require('mqtt');

const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';
const DEVICE_ID = 'btn_9182a0';
const BASE_TOPIC = 'buttonplus';

console.log('🔌 Connecting to MQTT...');
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => {
  console.log('✅ Connected\n');

  // Subscribe zu allen LED-Topics um Feedback zu sehen
  const sub = `${BASE_TOPIC}/${DEVICE_ID}/button/#`;
  console.log(`📡 Subscribing: ${sub}\n`);
  client.subscribe(sub, { qos: 0 });

  setTimeout(() => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Testing Button 1 LED (wie im funktionierenden Prototyp):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // GENAU wie im funktionierenden test-button-prototype.js:
    const buttonId = 1;

    console.log(`📤 Setting Button ${buttonId} LED to GREEN (65280)...\n`);

    publish(`${BASE_TOPIC}/${DEVICE_ID}/button/${buttonId}/led/front/rgb/set`, '65280');
    publish(`${BASE_TOPIC}/${DEVICE_ID}/button/${buttonId}/led/front/on/set`, 'true');

    console.log('\n⏳ Warte 2 Sekunden...\n');

    setTimeout(() => {
      console.log('📤 Setting Button ${buttonId} LED to RED (16711680)...\n');

      publish(`${BASE_TOPIC}/${DEVICE_ID}/button/${buttonId}/led/front/rgb/set`, '16711680');
      publish(`${BASE_TOPIC}/${DEVICE_ID}/button/${buttonId}/led/front/on/set`, 'true');

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Wenn die LED nicht leuchtet, schaue MQTT Messages unten:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }, 2000);
  }, 500);
});

client.on('message', (topic, payload) => {
  console.log(`📨 ${topic} = "${payload.toString()}"`);
});

client.on('error', (err) => {
  console.error('❌ Error:', err.message);
});

function publish(topic, payload) {
  console.log(`   📤 PUB: ${topic} = "${payload}"`);
  client.publish(topic, String(payload), { retain: true, qos: 0 });
}

process.on('SIGINT', () => {
  console.log('\n👋 Bye');
  client.end();
  process.exit(0);
});
