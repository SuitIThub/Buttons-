'use strict';

const CLICK_EVENT_SOURCES = [
    'payload',
    'topic',
    'device',
    'button_page',
    'button',
    'event_type',
    'buttonplus',
    'buttonplus_debug'
];

const ACTION_OUTPUT_SOURCES = [
    'buttonplus_debug'
];

function buildButtonplusMeta(context) {
    return {
        device: context.device,
        button_page: context.button_page,
        button: context.button,
        event_type: context.event_type,
        topic: context.topic
    };
}

function resolveClickOutputProperties(configured) {
    if (!configured || configured.length === 0) {
        return [];
    }
    return configured;
}

function getSourceValue(source, context) {
    switch (source) {
        case 'payload':
            return context.payload;
        case 'topic':
            return context.topic;
        case 'device':
            return context.device;
        case 'button_page':
            return context.button_page;
        case 'button':
            return context.button;
        case 'event_type':
            return context.event_type;
        case 'buttonplus':
            return buildButtonplusMeta(context);
        case 'buttonplus_debug':
            return context.buttonplus_debug;
        default:
            return undefined;
    }
}

function includesOutputSource(properties, source) {
    if (!properties || properties.length === 0) {
        return false;
    }

    return properties.some((rule) => (rule.value || rule.v) === source);
}

function setMessageProperty(msg, propertyType, property, value) {
    if (propertyType !== 'msg' && propertyType) {
        return;
    }

    const parts = String(property).split('.');
    let target = msg;

    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (target[key] === undefined || target[key] === null || typeof target[key] !== 'object') {
            target[key] = {};
        }
        target = target[key];
    }

    target[parts[parts.length - 1]] = value;
}

function applyRuleToMessage(msg, rule, context) {
    const property = rule.property || rule.p;
    const propertyType = rule.propertyType || rule.pt || 'msg';
    const source = rule.value || rule.v;
    const sourceType = rule.valueType || rule.vt || 'event';

    if (!property || !source) {
        return;
    }

    let value;
    if (sourceType === 'event') {
        value = getSourceValue(source, context);
    } else {
        value = source;
    }

    if (value !== undefined) {
        setMessageProperty(msg, propertyType, property, value);
    }
}

function applyClickOutputProperties(properties, context) {
    const rules = resolveClickOutputProperties(properties);
    const msg = {};

    for (const rule of rules) {
        applyRuleToMessage(msg, rule, context);
    }

    return msg;
}

function applyPassthroughOutputProperties(RED, properties, msg, context) {
    if (!properties || properties.length === 0) {
        return msg;
    }

    const outMsg = RED.util.cloneMessage(msg);

    for (const rule of properties) {
        applyRuleToMessage(outMsg, rule, context);
    }

    return outMsg;
}

function migrateLegacyDebugOutput(properties, legacyDebugEnabled) {
    if (!legacyDebugEnabled) {
        return properties;
    }

    if (properties && properties.length > 0) {
        return properties;
    }

    return [{
        property: 'buttonplus_debug',
        propertyType: 'msg',
        value: 'buttonplus_debug',
        valueType: 'event'
    }];
}

function buildPassthroughOutput(RED, properties, msg, debugInfo) {
    return applyPassthroughOutputProperties(RED, properties, msg, {
        buttonplus_debug: debugInfo
    });
}

module.exports = {
    CLICK_EVENT_SOURCES,
    ACTION_OUTPUT_SOURCES,
    buildButtonplusMeta,
    resolveClickOutputProperties,
    getSourceValue,
    includesOutputSource,
    applyClickOutputProperties,
    applyPassthroughOutputProperties,
    buildPassthroughOutput,
    migrateLegacyDebugOutput
};
