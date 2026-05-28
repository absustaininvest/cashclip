const baseConfig = require("./app.json");

module.exports = {
  ...baseConfig.expo,
  extra: {
    ...(baseConfig.expo.extra ?? {}),
    eas: {
      ...(baseConfig.expo.extra?.eas ?? {}),
    },
  },
};
