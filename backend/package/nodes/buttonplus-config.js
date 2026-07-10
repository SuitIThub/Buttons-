'use strict';

module.exports = function (RED) {
    function ButtonPlusConfigNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.prefix = n.prefix || 'buttonplus';
        node.device = n.device || '';
        node.broker = n.broker;
        node.qos = parseInt(n.qos, 10) || 0;
        node.retain = n.retain === true || n.retain === 'true';
        node.brokerConn = RED.nodes.getNode(node.broker);

        node.updateStatus = function () {
            if (!node.brokerConn) {
                node.status({ fill: 'red', shape: 'ring', text: 'no mqtt broker' });
                return;
            }
            if (node.brokerConn.connected) {
                node.status({ fill: 'green', shape: 'dot', text: 'connected' });
            } else {
                node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
            }
        };

        node.publish = function (topic, payload, options) {
            return new Promise((resolve, reject) => {
                if (!node.brokerConn) {
                    return reject(new Error('MQTT broker not configured'));
                }
                if (!node.brokerConn.connected) {
                    return reject(new Error('MQTT broker not connected'));
                }

                const msg = {
                    topic,
                    payload,
                    qos: options && options.qos !== undefined ? options.qos : node.qos,
                    retain: options && options.retain !== undefined ? options.retain : node.retain
                };

                node.brokerConn.publish(msg, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        };

        node.subscribe = function (topic, callback, ref) {
            if (!node.brokerConn) {
                throw new Error('MQTT broker not configured');
            }
            node.brokerConn.subscribe(topic, { qos: node.qos }, callback, ref);
        };

        node.unsubscribe = function (topic, ref) {
            if (!node.brokerConn) {
                return;
            }
            node.brokerConn.unsubscribe(topic, ref, true);
        };

        if (node.brokerConn) {
            node.brokerConn.register(node);
            node.updateStatus();
            node.on('close', (removed, done) => {
                node.brokerConn.deregister(node, done, removed);
                node.brokerConn = null;
            });
        } else {
            node.error('Missing MQTT broker config node');
        }
    }

    RED.nodes.registerType('buttonplus-config', ButtonPlusConfigNode);
};
