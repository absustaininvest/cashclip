import React, { useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

const DISMISSED_KEY = "cashclip_maintenance_banner_v1";

export default function MaintenanceBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY).then((val) => {
      if (val !== "1") setVisible(true);
    });
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(DISMISSED_KEY, "1");
  };

  return (
    <View style={styles.banner}>
      <View style={styles.row}>
        <Ionicons name="construct-outline" size={15} color="#92400e" />
        <Text style={styles.text}>
          Our systems are undergoing updates for a better experience. We appreciate your patience!
        </Text>
        <Pressable onPress={dismiss} hitSlop={12}>
          <Ionicons name="close" size={17} color="#92400e" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#fef3c7",
    borderBottomWidth: 1,
    borderBottomColor: "#fcd34d",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Outfit_400Regular",
    color: "#92400e",
    lineHeight: 17,
  },
});
