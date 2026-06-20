"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRIC_SHORT_NAMES = exports.METRIC_ALIASES = void 0;
exports.resolveMetricName = resolveMetricName;
exports.getMetricDisplayName = getMetricDisplayName;
const errors_1 = require("../commandUtils/errors");
exports.METRIC_ALIASES = {
    tti: 'expo.app_startup.tti',
    ttr: 'expo.app_startup.ttr',
    cold_launch: 'expo.app_startup.cold_launch_time',
    warm_launch: 'expo.app_startup.warm_launch_time',
    bundle_load: 'expo.app_startup.bundle_load_time',
};
const KNOWN_FULL_NAMES = new Set(Object.values(exports.METRIC_ALIASES));
exports.METRIC_SHORT_NAMES = {
    'expo.app_startup.cold_launch_time': 'Cold Launch',
    'expo.app_startup.warm_launch_time': 'Warm Launch',
    'expo.app_startup.tti': 'TTI',
    'expo.app_startup.ttr': 'TTR',
    'expo.app_startup.bundle_load_time': 'Bundle Load',
};
function resolveMetricName(input) {
    if (exports.METRIC_ALIASES[input]) {
        return exports.METRIC_ALIASES[input];
    }
    if (KNOWN_FULL_NAMES.has(input) || input.includes('.')) {
        return input;
    }
    throw new errors_1.EasCommandError(`Unknown metric: "${input}". Use a full metric name (e.g. expo.app_startup.tti) or a short alias: ${Object.keys(exports.METRIC_ALIASES).join(', ')}`);
}
function getMetricDisplayName(metricName) {
    return exports.METRIC_SHORT_NAMES[metricName] ?? metricName;
}
