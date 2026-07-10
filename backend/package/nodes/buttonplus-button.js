'use strict';

const { pushButtonTopic } = require('./lib/topics');
const { publishLedState } = require('./lib/led-actions');
const { resolveValue } = require('./lib/resolve');
const { parsePushbuttonEvent } = require('./lib/mqtt-payload');
const {
    applyClickOutputProperties,
    includesOutputSource,
    migrateLegacyDebugOutput
} = require('./lib/output-properties');
const { createPublishSession } = require('./lib/debug-output');

module.exports = function (RED) {
    function ButtonPlusButtonNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.config = RED.nodes.getNode(n.config);
        node.page = parseInt(n.page, 10);
        node.button = parseInt(n.button, 10);
        node.led = n.led || 'none';
        node.ledColor = n.ledColor || '#a10303';
        node.ledDuration = n.ledDuration;
        node.outputProperties = migrateLegacyDebugOutput(
            n.outputProperties,
            n.debugOutput === true || n.debugOutput === 'true'
        );

        if (!node.config) {
            node.error('Missing Button+ config node');
            return;
        }

        node.runtime = {
            device: null,
            page: null,
            button: null,
            led: null,
            ledColor: null,
            ledDuration: null
        };

        node.messageHandler = async function (topic, payload) {
            const event = parsePushbuttonEvent(payload);
            if (!event) {
                return;
            }

            const { payload: parsedPayload, eventType } = event;

            if (eventType !== 'shortpress' && eventType !== 'longpress') {
                node.status({ fill: 'yellow', shape: 'ring', text: eventType });
                return;
            }

            const ledParams = {
                prefix: node.config.prefix,
                device: node.runtime.device,
                page: node.runtime.page,
                button: node.runtime.button,
                led: node.runtime.led,
                color: node.runtime.ledColor,
                brightness: 100,
                duration: node.runtime.ledDuration,
                skipWhenNone: true
            };

            const needsDebug = includesOutputSource(node.outputProperties, 'buttonplus_debug');
            let buttonplus_debug;

            if (needsDebug) {
                const session = createPublishSession(node.config, true);

                if (node.runtime.led && node.runtime.led !== 'none') {
                    try {
                        await publishLedState(session.config, ledParams);
                    } catch (err) {
                        node.error(err.message);
                    }
                }

                buttonplus_debug = session.getDebugInfo({ topic, payload: parsedPayload });
            } else if (node.runtime.led && node.runtime.led !== 'none') {
                publishLedState(node.config, ledParams).catch((err) => node.error(err.message));
            }

            const outMsg = applyClickOutputProperties(node.outputProperties, {
                payload: parsedPayload,
                topic,
                device: node.runtime.device,
                button_page: node.runtime.page,
                button: node.runtime.button,
                event_type: eventType,
                buttonplus_debug
            });

            if (eventType === 'shortpress') {
                node.send([outMsg, null]);
            } else {
                node.send([null, outMsg]);
            }

            node.status({ fill: 'blue', shape: 'dot', text: eventType });
        };

        node.subscribeToButton = function () {
            const device = node.config.device;
            const page = resolveValue(undefined, node.page, 1);
            const button = resolveValue(undefined, node.button, 1);

            if (!device) {
                node.status({ fill: 'red', shape: 'ring', text: 'no device in config' });
                return;
            }

            if (!node.config.brokerConn) {
                node.status({ fill: 'red', shape: 'ring', text: 'no mqtt broker' });
                return;
            }

            node.runtime.device = device;
            node.runtime.page = page;
            node.runtime.button = button;
            node.runtime.led = node.led;
            node.runtime.ledColor = node.ledColor;
            node.runtime.ledDuration = node.ledDuration;

            const topic = pushButtonTopic(node.config.prefix, device, button, page);

            if (node.subscriptionTopic && node.subscriptionTopic !== topic) {
                node.config.unsubscribe(node.subscriptionTopic, node.id);
            }

            node.subscriptionTopic = topic;
            node.config.subscribe(topic, node.messageHandler, node.id);
            node.status({ fill: 'green', shape: 'ring', text: `${device} ${button}-${page}` });
        };

        node.subscribeToButton();

        node.on('input', function (msg, send, done) {
            done = done || function (err) { if (err) { node.error(err, msg); } };

            node.page = resolveValue(msg.page, node.page, 1);
            node.button = resolveValue(msg.button, node.button, 1);
            node.led = resolveValue(msg.led, node.led, 'none');
            node.ledColor = resolveValue(msg.led_color, node.ledColor, '#a10303');
            node.ledDuration = resolveValue(msg.led_delay, node.ledDuration, 0.5);

            node.subscribeToButton();
            done();
        });

        node.on('close', function (removed, done) {
            if (node.config && node.subscriptionTopic) {
                node.config.unsubscribe(node.subscriptionTopic, node.id);
            }
            done();
        });
    }

    RED.nodes.registerType('buttonplus-button', ButtonPlusButtonNode);
};
