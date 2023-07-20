const Buffer = require('safe-buffer').Buffer;
const utils = require('./utils');
const uint256Coder = utils.uint256Coder;
const coderBoolean = utils.coderBoolean;
const coderFixedBytes = utils.coderFixedBytes;
const coderAddress = utils.coderAddress;
const coderDynamicBytes = utils.coderDynamicBytes;
const coderString = utils.coderString;
const coderArray = utils.coderArray;
const paramTypePart = utils.paramTypePart;
const getParamCoder = utils.getParamCoder;

function Result() {}

function encodeParams(types, values) {
    if (types.length !== values.length) {
        throw new Error(`[neatjs-abi] while encoding params, types/values mismatch, Your contract requires ${types.length} types (arguments), and you passed in ${values.length}`);
    }

    var parts = [];

    types.forEach(function(type, index) {
        var coder = getParamCoder(type);
        parts.push({dynamic: coder.dynamic, value: coder.encode(values[index])});
    });

    function alignSize(size) {
        return parseInt(32 * Math.ceil(size / 32));
    }

    var staticSize = 0, dynamicSize = 0;
    parts.forEach(function(part) {
        if (part.dynamic) {
            staticSize += 32;
            dynamicSize += alignSize(part.value.length);
        } else {
            staticSize += alignSize(part.value.length);
        }
    });

    var offset = 0, dynamicOffset = staticSize;
    var data = Buffer.alloc(staticSize + dynamicSize);

    parts.forEach(function(part, index) {
        if (part.dynamic) {
            uint256Coder.encode(dynamicOffset).copy(data, offset);
            offset += 32;

            part.value.copy(data, dynamicOffset);
            dynamicOffset += alignSize(part.value.length);
        } else {
            part.value.copy(data, offset);
            offset += alignSize(part.value.length);
        }
    });

    return '0x' + data.toString('hex');
}
function decodeParams(names, types, data, useNumberedParams = true) {
    if (arguments.length < 3) {
        data = types;
        types = names;
        names = [];
    }

    data = utils.hexOrBuffer(data);
    var values = new Result();

    var offset = 0;
    types.forEach(function(type, index) {
        var coder = getParamCoder(type);

        if (coder.dynamic) {
            var dynamicOffset = uint256Coder.decode(data, offset);
            var result = coder.decode(data, dynamicOffset.value.toNumber());
            offset += dynamicOffset.consumed;
        } else {
            var result = coder.decode(data, offset);
            offset += result.consumed;
        }

        if (useNumberedParams) {
            values[index] = result.value;
        }

        if (names[index]) {
            values[names[index]] = result.value;
        }
    });
    return values;
}

let eventID = function (name, types) {
    let sig = name + '(' + types.map((value) => value).join(',') + ')'
    return utils.keccak256(Buffer.from(sig))
}

let methodID = function (name, types) {
    return eventID(name, types).slice(0, 10)
}

function encodeSignature(method) {
    const signature = `${method.name}(${utils.getKeys(method.inputs, 'type').join(',')})`;
    const signatureEncoded = `0x${Buffer.from(utils.keccak256(signature).slice(2), 'hex').slice(0, 4).toString('hex')}`;

    return signatureEncoded;
}

function encodeMethod(method, values) {
    const paramsEncoded = encodeParams(utils.getKeys(method.inputs, 'type'), values).substring(2);

    return `${encodeSignature(method)}${paramsEncoded}`;
}

function decodeMethod(method, data) {
    const outputNames = utils.getKeys(method.outputs, 'name', true);
    const outputTypes = utils.getKeys(method.outputs, 'type');

    return decodeParams(outputNames, outputTypes, utils.hexOrBuffer(data));
}

function encodeEvent(eventObject, values) {
    return encodeMethod(eventObject, values);
}

function eventSignature(eventObject) {
    const signature = `${eventObject.name}(${utils.getKeys(eventObject.inputs, 'type').join(',')})`;

    return utils.keccak256(signature);
}

function decodeEvent(eventObject, data, topics, useNumberedParams = true) {
    const nonIndexed = eventObject.inputs.filter((input) => !input.indexed)
    const nonIndexedNames = utils.getKeys(nonIndexed, 'name', true);
    const nonIndexedTypes = utils.getKeys(nonIndexed, 'type');
    const event = decodeParams(nonIndexedNames, nonIndexedTypes, utils.hexOrBuffer(data), useNumberedParams);
    const topicOffset = eventObject.anonymous ? 0 : 1;

    eventObject.inputs.filter((input) => input.indexed).map((input, i) => {
        const topic = Buffer.from(topics[i + topicOffset].slice(2), 'hex');
        const coder = getParamCoder(input.type);
        event[input.name] = coder.decode(topic, 0).value;
    });

    event._eventName = eventObject.name;

    return event;
}

function decodeLogItem(eventObject, log, useNumberedParams = true) {
    if (eventObject && log.topics[0] === eventSignature(eventObject)) {
        return decodeEvent(eventObject, log.data, log.topics, useNumberedParams)
    }
}

function logDecoder(abi, useNumberedParams = true) {
    const eventMap = {}
    abi.filter(item => item.type === 'event').map(item => {
        eventMap[eventSignature(item)] = item
    })
    return function(logItems) {
        return logItems.map(log => decodeLogItem(eventMap[log.topics[0]], log, useNumberedParams)).filter(i => i)
    }
}


module.exports = {
    methodID,
    encodeParams,
    decodeParams,
    encodeMethod,
    decodeMethod,
    encodeSignature,
    encodeEvent,
    decodeEvent,
    decodeLogItem,
    logDecoder,
    eventSignature,
    encodeSignature
};