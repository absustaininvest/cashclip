import { mergeConfig } from "vitest/config";
import base from "../../vitest.config.base";

export default mergeConfig(base, {
  test: {},
});
