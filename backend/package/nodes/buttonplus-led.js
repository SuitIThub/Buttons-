'use strict';

const { publishLedState } = require('./lib/led-actions');
const { createPublishSession } = require('./lib/debug-output');
const {
    buildPassthroughOutput,
    includesOutputSource,
    migrateLegacyDebugOutput
} = require('./lib/output-properties');
const { resolveValue } = require('./lib/resolve');

module.exports = function (RED) {
    function ButtonPlusLedNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.config = RED.nodes.getNode(n.config);
        node.page = parseInt(n.page, 10);
        node.button = parseInt(n.button, 10);
        node.led = n.led !== undefined && n.led !== null && n.led !== '' ? n.led : 'front';
        node.ledColor = n.ledColor || '#a10303';
        node.ledDuration = n.ledDuration || 'none';
        node.ledBrightness = parseInt(n.ledBrightness, 10);
        node.outputProperties = migrateLegacyDebugOutput(
            n.outputProperties,
            n.debugOutput === true || n.debugOutput === 'true'
        );

        if (!node.config) {
            node.error('Missing Button+ config node');
            return;
        }

        node.on('input', async function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };
            done = done || function (err) { if (err) { node.error(err, msg); } };

            try {
                const needsDebug = includesOutputSource(node.outputProperties, 'buttonplus_debug');
                const inputSnapshot = needsDebug ? RED.util.cloneMessage(msg) : null;
                const session = createPublishSession(node.config, needsDebug);
                const device = node.config.device;
                const page = resolveValue(msg.page, node.page, 1);
                const button = resolveValue(msg.button, node.button, 1);
                const led = resolveValue(msg.led, node.led, node.led);
                const color = resolveValue(msg.led_color, node.ledColor, '#a10303');
                const duration = resolveValue(msg.led_delay, node.ledDuration, 'none');
                const brightness = resolveValue(msg.led_brightness, node.ledBrightness, 100);

                if (!device) {
                    throw new Error('Device id is required');
                }

                await publishLedState(session.config, {
                    prefix: node.config.prefix,
                    device,
                    page,
                    button,
                    led,
                    color,
                    brightness,
                    duration,
                    skipWhenNone: false
                });

                node.status({ fill: 'green', shape: 'dot', text: `${device} ${button}-${page}` });
                send(buildPassthroughOutput(RED, node.outputProperties, msg, session.getDebugInfo(inputSnapshot)));
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: 'error' });
                done(err);
            }
        });
    }

    RED.nodes.registerType('buttonplus-led', ButtonPlusLedNode);
};
