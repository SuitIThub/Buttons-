'use strict';

const { deviceBaseTopic } = require('./lib/topics');
const { createPublishSession } = require('./lib/debug-output');
const {
    buildPassthroughOutput,
    includesOutputSource,
    migrateLegacyDebugOutput
} = require('./lib/output-properties');
const { parseOptionalNumber, resolvePublishNumberField } = require('./lib/resolve');

module.exports = function (RED) {
    function ButtonPlusUpdateGlobalNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.config = RED.nodes.getNode(n.config);
        node.page = parseOptionalNumber(n.page);
        node.brightness = parseOptionalNumber(n.brightness);
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
                const page = resolvePublishNumberField(msg, 'page', node.page);
                const brightness = resolvePublishNumberField(msg, 'brightness', node.brightness);

                if (!device) {
                    throw new Error('Device id is required');
                }

                const base = deviceBaseTopic(node.config.prefix, device);
                const config = session.config;
                const publishes = [];
                const statusParts = [];

                if (page.publish) {
                    const pageValue = String(page.value);
                    publishes.push(config.publish(`${base}/page/set`, pageValue));
                    statusParts.push(`page ${pageValue}`);
                }
                if (brightness.publish) {
                    publishes.push(config.publish(`${base}/brightness/set`, brightness.value));
                    statusParts.push(`brightness ${brightness.value}`);
                }

                if (publishes.length === 0) {
                    node.status({ fill: 'yellow', shape: 'ring', text: 'nothing to publish' });
                    send(buildPassthroughOutput(RED, node.outputProperties, msg, session.getDebugInfo(inputSnapshot)));
                    done();
                    return;
                }

                await Promise.all(publishes);

                node.status({ fill: 'green', shape: 'dot', text: statusParts.join(', ') });
                send(buildPassthroughOutput(RED, node.outputProperties, msg, session.getDebugInfo(inputSnapshot)));
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: 'error' });
                done(err);
            }
        });
    }

    RED.nodes.registerType('buttonplus-update-global', ButtonPlusUpdateGlobalNode);
};
