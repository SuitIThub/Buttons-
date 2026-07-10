'use strict';

const { buttonBaseTopic } = require('./lib/topics');
const { publishLedState } = require('./lib/led-actions');
const { createPublishSession } = require('./lib/debug-output');
const {
    buildPassthroughOutput,
    includesOutputSource,
    migrateLegacyDebugOutput
} = require('./lib/output-properties');
const { resolveValue, normalizeOptionalField, resolveAlwaysPublishField } = require('./lib/resolve');

module.exports = function (RED) {
    function ButtonPlusUpdateButtonNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.config = RED.nodes.getNode(n.config);
        node.page = parseInt(n.page, 10);
        node.button = parseInt(n.button, 10);
        node.led = n.led || 'none';
        node.ledColor = n.ledColor || '#a10303';
        node.ledDuration = n.ledDuration || 'none';
        node.labelText = normalizeOptionalField(n.labelText);
        node.valueText = normalizeOptionalField(n.valueText);
        node.svgText = normalizeOptionalField(n.svgText);
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
                const label = resolveAlwaysPublishField(msg, 'label', node.labelText);
                const value = resolveAlwaysPublishField(msg, 'value', node.valueText);
                const svg = resolveAlwaysPublishField(msg, 'svg', node.svgText);
                const led = resolveValue(msg.led, node.led, 'none');
                const color = resolveValue(msg.led_color, node.ledColor, '#a10303');
                const duration = resolveValue(msg.led_delay, node.ledDuration, 'none');

                if (!device) {
                    throw new Error('Device id is required');
                }

                const base = buttonBaseTopic(node.config.prefix, device, button, page);
                const config = session.config;

                if (label.publish) {
                    await config.publish(`${base}/toplabel/set`, label.value);
                }

                if (value.publish) {
                    await config.publish(`${base}/label/set`, value.value);
                }

                if (svg.publish) {
                    await config.publish(`${base}/svg/set`, svg.value);
                }

                await publishLedState(config, {
                    prefix: node.config.prefix,
                    device,
                    page,
                    button,
                    led,
                    color,
                    brightness: resolveValue(msg.led_brightness, undefined, 100),
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

    RED.nodes.registerType('buttonplus-update-button', ButtonPlusUpdateButtonNode);
};
