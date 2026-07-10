'use strict';

function resolveValue(msgValue, nodeValue, fallbackValue) {
    if (msgValue !== undefined && msgValue !== null) {
        return msgValue;
    }
    if (nodeValue !== undefined && nodeValue !== null && nodeValue !== '') {
        return nodeValue;
    }
    if (fallbackValue !== undefined) {
        return fallbackValue;
    }
    return undefined;
}

function normalizeOptionalField(value) {
    if (value === false || value === 'false') {
        return '';
    }
    if (value === undefined || value === null) {
        return '';
    }
    return value;
}

function resolvePublishField(msg, msgKey, nodeValue) {
    if (Object.prototype.hasOwnProperty.call(msg, msgKey)) {
        const msgValue = msg[msgKey];
        if (msgValue !== undefined && msgValue !== null) {
            return { publish: true, value: normalizeOptionalField(msgValue) };
        }
    }

    const nodeNormalized = normalizeOptionalField(nodeValue);
    if (nodeNormalized !== '') {
        return { publish: true, value: nodeNormalized };
    }

    return { publish: false };
}

function resolvePublishNumberField(msg, msgKey, nodeValue) {
    if (Object.prototype.hasOwnProperty.call(msg, msgKey)) {
        const msgValue = msg[msgKey];
        if (msgValue !== undefined && msgValue !== null && msgValue !== '') {
            const num = Number(msgValue);
            if (!Number.isNaN(num)) {
                return { publish: true, value: num };
            }
            return { publish: false };
        }
        return { publish: false };
    }

    const normalized = normalizeOptionalField(nodeValue);
    if (normalized === '' || normalized === false) {
        return { publish: false };
    }

    const num = Number(normalized);
    if (Number.isNaN(num)) {
        return { publish: false };
    }

    return { publish: true, value: num };
}

function parseOptionalNumber(value) {
    const field = resolvePublishNumberField({}, 'value', value);
    return field.publish ? field.value : '';
}

function resolveAlwaysPublishField(msg, msgKey, nodeValue) {
    if (Object.prototype.hasOwnProperty.call(msg, msgKey)) {
        const msgValue = msg[msgKey];
        if (msgValue !== undefined && msgValue !== null) {
            return { publish: true, value: normalizeOptionalField(msgValue) };
        }
    }

    return { publish: true, value: normalizeOptionalField(nodeValue) };
}

function parseDurationSeconds(value) {
    if (value === undefined || value === null || value === '' || value === 'none' || value === 'steady') {
        return null;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

module.exports = {
    resolveValue,
    normalizeOptionalField,
    resolvePublishField,
    resolvePublishNumberField,
    parseOptionalNumber,
    resolveAlwaysPublishField,
    parseDurationSeconds
};
