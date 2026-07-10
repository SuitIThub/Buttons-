'use strict';

function parseMqttPayload(payload) {
    if (payload === null || payload === undefined) {
        return null;
    }

    if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
        return payload;
    }

    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
    if (text === '') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        return { event_type: text };
    }
}

function parsePushbuttonEvent(payload) {
    const parsed = parseMqttPayload(payload);
    if (!parsed) {
        return null;
    }

    const eventType = parsed.event_type || parsed.eventType;
    if (!eventType) {
        return null;
    }

    return {
        payload: parsed,
        eventType: String(eventType)
    };
}

module.exports = {
    parseMqttPayload,
    parsePushbuttonEvent
};
