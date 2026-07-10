/**
 * MQTT Topic Cleanup - Löscht alle retained messages
 */

const mqtt = require('mqtt');

const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';
const DEVICE_ID = 'btn_9182a0';
const BASE_TOPIC = 'buttonplus';

console.log('🧹 Cleaning MQTT retained messages...\n');

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => {
  console.log('✅ Connected\n');

  // Subscribe zu allen Topics
  const wildcard = `${BASE_TOPIC}/${DEVICE_ID}/#`;
  console.log(`📡 Subscribing: ${wildcard}`);

  client.subscribe(wildcard, { qos: 0 }, (err) => {
    if (err) {
      console.error('❌ Subscribe failed:', err);
      process.exit(1);
    }
    console.log('✅ Subscribed - listening for retained messages...\n');
  });

  const retainedTopics = new Set();
  let timeout = null;

  client.on('message', (topic, payload) => {
    retainedTopics.add(topic);

    // Reset timeout - warte bis keine Messages mehr kommen
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log(`\n📋 Found ${retainedTopics.size} retained topics\n`);

      if (retainedTopics.size === 0) {
        console.log('✅ No retained messages found - nothing to clean\n');
        client.end();
        process.exit(0);
      }

      console.log('🗑️  Deleting retained messages...\n');

      let deleted = 0;
      retainedTopics.forEach((topic) => {
        // Leeres retained message = löschen
        client.publish(topic, '', { retain: true, qos: 0 }, () => {
          deleted++;
          console.log(`   [${deleted}/${retainedTopics.size}] Deleted: ${topic}`);

          if (deleted === retainedTopics.size) {
            console.log('\n✅ All retained messages deleted!\n');
            client.end();
            process.exit(0);
          }
        });
      });
    }, 1000); // Warte 1 Sekunde nach letzter Message
  });
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
  process.exit(1);
});

// Timeout nach 10 Sekunden falls nichts passiert
setTimeout(() => {
  console.log('\n⚠️  Timeout - exiting\n');
  client.end();
  process.exit(0);
}, 10000);
