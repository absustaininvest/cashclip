package com.logrocket.core;

import java.util.Map;

public class IdentifyHelper {

  public static void identify(String userId, Map<String, String> userInfo, Boolean isAnonymous) {
    PostInitializationTasks.run(
        (core, timeOverride) -> core.identify(userId, userInfo, isAnonymous, timeOverride));
  }
}
