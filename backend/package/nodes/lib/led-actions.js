'use strict';

const { ledBaseTopic } = require('./topics');
const { parseDurationSeconds } = require('./resolve');

const SETTLE_MS = 100;
const ALL_LEDS = ['front', 'wall'];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveLedTargets(led) {
    if (!led || led === 'none') {
        return [];
    }
    if (led === 'both' || led === 'front+wall' || led === 'front_wall') {
        return ALL_LEDS.slice();
    }
    if (led === 'front' || led === 'wall') {
        return [led];
    }
    throw new Error(`Unknown LED selection: ${led}`);
}

async function publishSingleLedOn(config, params) {
    const {
        prefix,
        device,
        page,
        button,
        led,
        color,
        brightness,
        duration
    } = params;

    const base = ledBaseTopic(prefix, device, button, page, led);
    const durationSec = parseDurationSeconds(duration);
    const ledBrightness = brightness !== undefined && brightness !== null ? Number(brightness) : 100;

    await config.publish(`${base}/rgb/set`, color);
    await config.publish(`${base}/brightness/set`, ledBrightness);
    await sleep(SETTLE_MS);

    if (durationSec === null) {
        await config.publish(`${base}/on/set`, true);
        return;
    }

    await config.publish(`${base}/on/set`, true);
    await sleep(durationSec * 1000);
    await config.publish(`${base}/on/set`, false);
}

async function publishSingleLedOff(config, params) {
    const {
        prefix,
        device,
        page,
        button,
        led,
        color,
        brightness
    } = params;

    const base = ledBaseTopic(prefix, device, button, page, led);
    const ledBrightness = brightness !== undefined && brightness !== null ? Number(brightness) : 100;

    if (color !== undefined && color !== null && color !== '') {
        await config.publish(`${base}/rgb/set`, color);
    }
    await config.publish(`${base}/brightness/set`, ledBrightness);
    await sleep(SETTLE_MS);
    await config.publish(`${base}/on/set`, false);
}

async function publishLedOff(config, params) {
    const { prefix, device, page, button, color, brightness } = params;

    for (const led of ALL_LEDS) {
        await publishSingleLedOff(config, { prefix, device, page, button, led, color, brightness });
    }
}

async function publishLedState(config, params) {
    const {
        led,
        skipWhenNone = false,
        prefix,
        device,
        page,
        button,
        color,
        brightness,
        duration
    } = params;

    const baseParams = { prefix, device, page, button, color, brightness, duration };

    if (!led || led === 'none') {
        if (skipWhenNone) {
            return;
        }
        await publishLedOff(config, baseParams);
        return;
    }

    const targets = resolveLedTargets(led);
    for (const target of targets) {
        await publishSingleLedOn(config, { ...baseParams, led: target });
    }
}

module.exports = {
    publishLedState,
    publishLedOff,
    resolveLedTargets,
    SETTLE_MS
};
