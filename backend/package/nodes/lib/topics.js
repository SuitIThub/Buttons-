'use strict';

function normalizePrefix(prefix) {
    const value = (prefix || 'buttonplus').trim();
    return value.replace(/\/+$/, '');
}

function buttonBaseTopic(prefix, device, button, page) {
    return `${normalizePrefix(prefix)}/${device}/button/${button}-${page}`;
}

function ledBaseTopic(prefix, device, button, page, led) {
    return `${buttonBaseTopic(prefix, device, button, page)}/led/${led}`;
}

function pushButtonTopic(prefix, device, button, page) {
    return `${buttonBaseTopic(prefix, device, button, page)}/pushbutton`;
}

function displayItemBaseTopic(prefix, device, item) {
    return `${normalizePrefix(prefix)}/${device}/displayitem/${item}`;
}

function deviceBaseTopic(prefix, device) {
    return `${normalizePrefix(prefix)}/${device}`;
}

module.exports = {
    normalizePrefix,
    buttonBaseTopic,
    ledBaseTopic,
    pushButtonTopic,
    displayItemBaseTopic,
    deviceBaseTopic
};
