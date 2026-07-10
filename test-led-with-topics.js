/**
 * LED TEST MIT TOPICS
 *
 * Testet LED-Steuerung über Config-Topics basierend auf Dokumentation:
 * - LED (subscribe): Topic + Payload "on" → LED an
 * - onrgb = Farbe wenn LED an ist
 */

const http = require('http');
const mqtt = require('mqtt');

const DEVICE_IP = '192.168.178.33';
const MQTT_URL = 'mqtt://crenserver:1883';
const MQTT_USER = 'GIS';
const MQTT_PASS = 'GIS2017!';

// Teste verschiedene eventtypes für LED (subscribe)
const LED_EVENTTYPE_CANDIDATES = [3, 4, 5, 7, 8, 9, 12, 13, 14, 16, 17, 18];

console.log('🧪 LED Topic-Test\n');
console.log('Basierend auf Dokumentation:');
console.log('  - LED (subscribe): Topic + Payload "on" → LED an');
console.log('  - onrgb: Farbe wenn aktiviert\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function fetchConfig() {
  return new Promise((resolve, reject) => {
    http.get(`http://${DEVICE_IP}/config`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    });
  });
}

async function pushConfig(config) {
  return new Promise((resolve, reject) => {
    const jsonData = JSON.stringify(config);
    const options = {
      hostname: DEVICE_IP,
      port: 80,
      path: '/configsave',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(jsonData);
    req.end();
  });
}

async function main() {
  try {
    // 1. Config laden
    console.log('📥 Lade Config...');
    const config = await fetchConfig();
    console.log(`✅ ${config.buttons?.length || 0} Buttons geladen\n`);

    // 2. Button 3 LED konfigurieren mit Topic
    const button3 = config.buttons?.find(b => b.position === 3 && b.page === 1);

    if (!button3) {
      console.error('❌ Button 3 nicht gefunden!');
      process.exit(1);
    }

    console.log('🔧 Konfiguriere Button 3 LED mit Topics:\n');

    // Teste ERSTEN eventtype-Kandidaten
    const testEventtype = LED_EVENTTYPE_CANDIDATES[0];

    button3.leds = [
      {
        frontwall: 'front',
        onrgb: 16711680, // Rot
        topics: [
          {
            brokerid: 'buttonplus',
            topic: 'test/led3/front',
            payload: 'on',
            eventtype: testEventtype,  // TEST!
          },
        ],
      },
      {
        frontwall: 'wall',
        onrgb: 65280, // Grün
        topics: [
          {
            brokerid: 'buttonplus',
            topic: 'test/led3/wall',
            payload: 'on',
            eventtype: testEventtype,  // TEST!
          },
        ],
      },
    ];

    console.log(`   FRONT LED: Rot (16711680)`);
    console.log(`      Topic: test/led3/front`);
    console.log(`      Payload: "on"`);
    console.log(`      Eventtype: ${testEventtype} (TEST)\n`);

    console.log(`   WALL LED: Grün (65280)`);
    console.log(`      Topic: test/led3/wall`);
    console.log(`      Payload: "on"`);
    console.log(`      Eventtype: ${testEventtype} (TEST)\n`);

    // 3. Config schreiben
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 Schreibe Config...\n');
    await pushConfig(config);
    console.log('✅ Config geschrieben!\n');

    // 4. Warte aufs Gerät
    console.log('⏳ Warte 3 Sekunden...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. MQTT publishen um LEDs zu aktivieren
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📡 Verbinde mit MQTT...\n');

    const client = mqtt.connect(MQTT_URL, {
      username: MQTT_USER,
      password: MQTT_PASS,
    });

    client.on('connect', () => {
      console.log('✅ MQTT verbunden\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📤 Publishe LED-Trigger...\n');

      client.publish('test/led3/front', 'on', { retain: true });
      console.log('   ✓ test/led3/front = "on"');

      client.publish('test/led3/wall', 'on', { retain: true });
      console.log('   ✓ test/led3/wall = "on"\n');

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('👀 SCHAUE AUF BUTTON 3!\n');
      console.log('   FRONT LED sollte ROT leuchten');
      console.log('   WALL LED sollte GRÜN leuchten\n');
      console.log(`   Wenn NICHTS leuchtet: eventtype ${testEventtype} ist falsch!`);
      console.log(`   → Teste dann andere Werte: ${LED_EVENTTYPE_CANDIDATES.join(', ')}\n`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      setTimeout(() => {
        client.end();
        process.exit(0);
      }, 2000);
    });

    client.on('error', (err) => {
      console.error('❌ MQTT Error:', err.message);
      process.exit(1);
    });

  } catch (err) {
    console.error('❌ Fehler:', err.message);
    process.exit(1);
  }
}

main();
