'use strict';

const DEBUG_PROPERTY = 'buttonplus_debug';

function wrapConfigForTrace(config, trace) {
    return {
        publish(topic, payload, options) {
            trace.push({
                topic,
                payload,
                qos: options && options.qos !== undefined ? options.qos : config.qos,
                retain: options && options.retain !== undefined ? options.retain : config.retain
            });
            return config.publish(topic, payload, options);
        }
    };
}

function createPublishSession(config, debugEnabled) {
    const mqtt = [];
    const publishConfig = debugEnabled ? wrapConfigForTrace(config, mqtt) : config;

    return {
        config: publishConfig,
        getDebugInfo(inputMsg) {
            if (!debugEnabled) {
                return null;
            }

            return {
                input: inputMsg,
                mqtt: mqtt.slice()
            };
        }
    };
}

module.exports = {
    DEBUG_PROPERTY,
    wrapConfigForTrace,
    createPublishSession
};
