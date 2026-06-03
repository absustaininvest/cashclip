import { mergeConfig } from "vitest/config";
import base from "../../vitest.config.base";
import { resolve } from "path";

export default mergeConfig(base, {
  test: {
    alias: {
      "@react-native-async-storage/async-storage": resolve(
        __dirname,
        "__mocks__/@react-native-async-storage/async-storage.ts"
      ),
    },
  },
});
