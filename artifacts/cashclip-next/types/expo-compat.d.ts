declare module "expo-linear-gradient" {
  type ViewStyleProp = import("react-native").StyleProp<import("react-native").ViewStyle>;
  type ReactNode = import("react").ReactNode;

  export interface LinearGradientProps {
    colors: readonly (string | number)[];
    start?: { x: number; y: number } | [number, number] | null;
    end?: { x: number; y: number } | [number, number] | null;
    locations?: number[] | null;
    dither?: boolean;
    style?: ViewStyleProp;
    children?: ReactNode;
    testID?: string;
    accessible?: boolean;
    accessibilityLabel?: string;
    pointerEvents?: "box-none" | "none" | "box-only" | "auto";
    onLayout?: import("react-native").ViewProps["onLayout"];
  }
  export type LinearGradientPoint = { x: number; y: number };
  export const LinearGradient: import("react").ComponentType<LinearGradientProps>;
}

declare module "expo-blur" {
  type ViewStyleProp = import("react-native").StyleProp<import("react-native").ViewStyle>;
  type ReactNode = import("react").ReactNode;

  export type BlurTint =
    | "light"
    | "dark"
    | "default"
    | "extraLight"
    | "regular"
    | "prominent"
    | "systemUltraThinMaterial"
    | "systemThinMaterial"
    | "systemMaterial"
    | "systemThickMaterial"
    | "systemChromeMaterial"
    | "systemUltraThinMaterialLight"
    | "systemThinMaterialLight"
    | "systemMaterialLight"
    | "systemThickMaterialLight"
    | "systemChromeMaterialLight"
    | "systemUltraThinMaterialDark"
    | "systemThinMaterialDark"
    | "systemMaterialDark"
    | "systemThickMaterialDark"
    | "systemChromeMaterialDark";

  export interface BlurViewProps {
    intensity?: number;
    tint?: BlurTint;
    blurReductionFactor?: number;
    experimentalBlurMethod?: "none" | "dimezisBlurView";
    style?: ViewStyleProp;
    children?: ReactNode;
    testID?: string;
    pointerEvents?: "box-none" | "none" | "box-only" | "auto";
  }
  export const BlurView: import("react").ComponentType<BlurViewProps>;
}

declare module "react-native-gesture-handler" {
  type ViewStyleProp = import("react-native").StyleProp<import("react-native").ViewStyle>;
  type ReactNode = import("react").ReactNode;

  export interface GestureHandlerRootViewProps {
    style?: ViewStyleProp;
    children?: ReactNode;
    testID?: string;
  }
  export const GestureHandlerRootView: import("react").ComponentType<GestureHandlerRootViewProps>;
}
