/**
 * FIX BUTTON CONFIG - Position 1-8 statt 0-7
 */
const http = require('http');

const DEVICE_IP = '192.168.178.33';

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
  console.log('📥 Lade Config...\n');
  const config = await fetchConfig();

  console.log('❌ ENTFERNE Buttons mit Position 0...');
  config.buttons = config.buttons.filter(b => b.position !== 0);

  console.log('✅ FÜGE Button mit Position 8 hinzu...\n');

  // Finde einen Button als Template (Position 1)
  const template = config.buttons.find(b => b.position === 1 && b.page === 1);

  if (!template) {
    console.error('❌ Kein Template-Button gefunden!');
    process.exit(1);
  }

  // Erstelle Button 8 für beide Pages
  for (let page = 1; page <= 2; page++) {
    const newButton = JSON.parse(JSON.stringify(template)); // Deep copy
    newButton.buttonid = `8-${page}`;
    newButton.position = 8;
    newButton.page = page;
    newButton.label = '';
    newButton.toplabel = '';

    config.buttons.push(newButton);
  }

  // Zeige neue Struktur
  console.log('=== NEUE BUTTON-STRUKTUR ===\n');
  const page1Buttons = config.buttons
    .filter(b => b.page === 1)
    .sort((a, b) => a.position - b.position);

  page1Buttons.forEach(b => {
    console.log(`  Button ${b.position}: ${b.buttonid}`);
  });

  console.log('\n📤 Schreibe Config aufs Gerät...\n');
  await pushConfig(config);

  console.log('✅ FERTIG! Buttons 1-8 sind jetzt konfiguriert!\n');
}

main().catch(err => {
  console.error('❌ Fehler:', err.message);
  process.exit(1);
});
