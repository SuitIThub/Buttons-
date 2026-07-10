/**
 * LED CONFIG TEST
 *
 * Testet ob LEDs über Device-Config steuerbar sind
 */

const http = require('http');

const DEVICE_IP = '192.168.178.33';

// Test-Farben
const COLORS = {
  RED: 16711680,    // #FF0000
  GREEN: 65280,     // #00FF00
  BLUE: 255,        // #0000FF
  YELLOW: 16776960, // #FFFF00
  MAGENTA: 16711935,// #FF00FF
  CYAN: 65535,      // #00FFFF
  OFF: 0,           // Aus
};

console.log('🔧 LED Config Test\n');
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
      path: '/configsave',  // ← RICHTIG!
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
    console.log('📥 Lade aktuelle Config...');
    const config = await fetchConfig();
    console.log(`✅ Config geladen (${config.buttons?.length || 0} Buttons)\n`);

    // 2. LED-Farben für erste 8 Buttons setzen
    console.log('🌈 Setze LED-Farben für Buttons 0-7:\n');

    const testButtons = [
      { pos: 0, front: COLORS.RED, back: COLORS.GREEN },
      { pos: 1, front: COLORS.GREEN, back: COLORS.BLUE },
      { pos: 2, front: COLORS.BLUE, back: COLORS.YELLOW },
      { pos: 3, front: COLORS.YELLOW, back: COLORS.MAGENTA },
      { pos: 4, front: COLORS.MAGENTA, back: COLORS.CYAN },
      { pos: 5, front: COLORS.CYAN, back: COLORS.RED },
      { pos: 6, front: COLORS.OFF, back: COLORS.OFF },     // Aus
      { pos: 7, front: COLORS.RED, back: COLORS.RED },     // Beide rot
    ];

    for (const btn of testButtons) {
      // Button in Config finden
      const buttonConfig = config.buttons?.find(b => b.position === btn.pos && b.page === 1);

      if (!buttonConfig) {
        console.log(`⚠️  Button ${btn.pos} nicht gefunden in Config!`);
        continue;
      }

      // LEDs setzen
      if (!buttonConfig.leds) {
        buttonConfig.leds = [
          { frontwall: 'front', onrgb: 0, topics: [] },
          { frontwall: 'wall', onrgb: 0, topics: [] },
        ];
      }

      // Front LED
      if (buttonConfig.leds[0]) {
        buttonConfig.leds[0].onrgb = btn.front;
      }

      // Back/Wall LED
      if (buttonConfig.leds[1]) {
        buttonConfig.leds[1].onrgb = btn.back;
      }

      console.log(`   Button ${btn.pos}:`);
      console.log(`      FRONT: ${btn.front.toString().padEnd(8)} (${getColorName(btn.front)})`);
      console.log(`      BACK:  ${btn.back.toString().padEnd(8)} (${getColorName(btn.back)})`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 Schreibe Config aufs Gerät...\n');

    // 3. Config zurückschreiben
    const response = await pushConfig(config);
    console.log(`✅ Response: ${response}\n`);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👀 Schaue auf dein Button+ Gerät!');
    console.log('   Leuchten die LEDs jetzt in verschiedenen Farben?\n');
    console.log('⚠️  HINWEIS: Das Gerät könnte neu laden - warte 5 Sekunden');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Fehler:', err.message);
    process.exit(1);
  }
}

function getColorName(rgb) {
  const names = {
    [COLORS.RED]: 'Rot',
    [COLORS.GREEN]: 'Grün',
    [COLORS.BLUE]: 'Blau',
    [COLORS.YELLOW]: 'Gelb',
    [COLORS.MAGENTA]: 'Magenta',
    [COLORS.CYAN]: 'Cyan',
    [COLORS.OFF]: 'Aus',
  };
  return names[rgb] || '#' + rgb.toString(16).padStart(6, '0');
}

main();
