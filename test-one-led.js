const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://crenserver:1883', {
  username: 'GIS',
  password: 'GIS2017!',
});

client.on('connect', () => {
  console.log('✅ Connected - Setting Button 3 LED to RED\n');

  // Button 3 Page 1 LED Front = ROT (mit -page suffix!)
  client.publish('buttonplus/btn_9182a0/button/3-1/led/front/rgb/set', '16711680', { retain: true });
  client.publish('buttonplus/btn_9182a0/button/3-1/led/front/brightness/set', '255', { retain: true });
  client.publish('buttonplus/btn_9182a0/button/3-1/led/front/on/set', 'true', { retain: true });

  console.log('📤 buttonplus/btn_9182a0/button/3-1/led/front/rgb/set = 16711680');
  console.log('📤 buttonplus/btn_9182a0/button/3-1/led/front/brightness/set = 255');
  console.log('📤 buttonplus/btn_9182a0/button/3-1/led/front/on/set = true\n');
  console.log('👀 Schau auf Button 3 Page 1 - leuchtet die FRONT LED ROT?\n');

  setTimeout(() => {
    client.end();
    process.exit(0);
  }, 1000);
});
