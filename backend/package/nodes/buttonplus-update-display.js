'use strict';

const { displayItemBaseTopic } = require('./lib/topics');
const { createPublishSession } = require('./lib/debug-output');
const {
    buildPassthroughOutput,
    includesOutputSource,
    migrateLegacyDebugOutput
} = require('./lib/output-properties');
const { resolveValue, normalizeOptionalField, resolvePublishField } = require('./lib/resolve');

module.exports = function (RED) {
    function ButtonPlusUpdateDisplayNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.config = RED.nodes.getNode(n.config);
        node.item = parseInt(n.item, 10);
        node.label = normalizeOptionalField(n.label);
        node.value = normalizeOptionalField(n.value);
        node.unit = normalizeOptionalField(n.unit);
        node.svg = normalizeOptionalField(n.svg);
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
                const item = resolveValue(msg.item, node.item, 1);
                const label = resolvePublishField(msg, 'label', node.label);
                const value = resolvePublishField(msg, 'value', node.value);
                const unit = resolvePublishField(msg, 'unit', node.unit);
                const svg = resolvePublishField(msg, 'svg', node.svg);

                if (!device) {
                    throw new Error('Device id is required');
                }

                const base = displayItemBaseTopic(node.config.prefix, device, item);
                const config = session.config;
                const publishes = [];

                if (svg.publish) {
                    publishes.push(config.publish(`${base}/svg/set`, svg.value));
                }
                if (label.publish) {
                    publishes.push(config.publish(`${base}/label/set`, label.value));
                }
                if (value.publish) {
                    publishes.push(config.publish(`${base}/value/set`, value.value));
                }
                if (unit.publish) {
                    publishes.push(config.publish(`${base}/unit/set`, unit.value));
                }

                await Promise.all(publishes);

                node.status({ fill: 'green', shape: 'dot', text: `${device} item ${item}` });
                send(buildPassthroughOutput(RED, node.outputProperties, msg, session.getDebugInfo(inputSnapshot)));
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: 'error' });
                done(err);
            }
        });
    }

    RED.nodes.registerType('buttonplus-update-display', ButtonPlusUpdateDisplayNode);
};
