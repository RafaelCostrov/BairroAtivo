import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ComponentPropsWithRef, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { TextProps } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Status } from "@bairroativo/shared";
import {
  colors,
  fonts,
  maxWidth,
  spaces,
  statusLabel,
  statusTone,
} from "./theme";

export type IconName = ComponentProps<typeof Feather>["name"];

export function Icon({
  name,
  size = 19,
  color = colors.primary,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} accessible={false} />;
}

export function Copy({ style, ...props }: TextProps) {
  return <Text style={[styles.copy, style]} {...props} />;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Copy accessibilityRole="header" style={styles.title}>
      {children}
    </Copy>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Copy accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Copy>
  );
}

export function Button({
  label,
  onPress,
  icon,
  secondary = false,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const foreground = secondary ? colors.primary : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        (pressed || disabled || busy) && styles.dim,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        icon && <Icon name={icon} color={foreground} />
      )}
      <Copy style={[styles.buttonText, { color: foreground }]}>{label}</Copy>
    </Pressable>
  );
}

export function IconButton({
  label,
  name,
  onPress,
}: {
  label: string;
  name: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.dim]}
    >
      <Icon name={name} />
    </Pressable>
  );
}

export function Screen({
  children,
  tab = false,
}: {
  children: ReactNode;
  tab?: boolean;
}) {
  return (
    <SafeAreaView
      style={styles.safe}
      edges={
        tab ? ["top", "left", "right"] : ["top", "left", "right", "bottom"]
      }
    >
      <View style={styles.screen}>{children}</View>
    </SafeAreaView>
  );
}

export function Header({
  userName,
  back = false,
  label,
}: {
  userName?: string;
  back?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace("/");
  return (
    <View style={styles.header}>
      {back ? (
        <View style={styles.brand}>
          <IconButton label="Voltar" name="arrow-left" onPress={goBack} />
          <Copy style={styles.headerLabel}>{label}</Copy>
        </View>
      ) : (
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Icon name="map-pin" size={17} color={colors.primaryText} />
          </View>
          <Copy style={styles.brandText}>BairroAtivo</Copy>
        </View>
      )}
      {userName && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Perfil, ${userName}`}
          onPress={() => router.push("/profile")}
          style={({ pressed }) => [styles.profile, pressed && styles.dim]}
        >
          <Icon name="user" size={16} />
          <Copy style={styles.profileName} numberOfLines={1}>
            {userName.split(" ")[0]}
          </Copy>
        </Pressable>
      )}
    </View>
  );
}

export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return (
    <View
      style={[styles.notice, error && styles.noticeError]}
      accessibilityLiveRegion="polite"
    >
      <Icon
        name={error ? "alert-circle" : "info"}
        color={error ? colors.danger : colors.primary}
        size={17}
      />
      <Copy style={[styles.noticeText, error && { color: colors.danger }]}>
        {message}
      </Copy>
    </View>
  );
}

export function State({
  title,
  detail,
  retry,
  loading = false,
  icon = "inbox",
}: {
  title: string;
  detail?: string;
  retry?: () => void;
  loading?: boolean;
  icon?: IconName;
}) {
  return (
    <View style={styles.state}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.stateIcon}>
          <Icon name={icon} size={23} />
        </View>
      )}
      <Copy accessibilityLiveRegion="polite" style={styles.stateTitle}>
        {title}
      </Copy>
      {detail && <Copy style={styles.stateDetail}>{detail}</Copy>}
      {retry && <Button label="Tentar novamente" onPress={retry} secondary />}
    </View>
  );
}

export function StatusTag({ status }: { status: Status }) {
  const tone = statusTone[status];
  return (
    <View style={[styles.tag, { backgroundColor: tone.backgroundColor }]}>
      <Copy style={[styles.tagText, { color: tone.color }]}>
        {statusLabel[status]}
      </Copy>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Copy style={selected ? styles.chipTextSelected : styles.chipText}>
        {label}
      </Copy>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  style,
  ...props
}: ComponentPropsWithRef<typeof TextInput> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Copy style={styles.label}>{label}</Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          error && styles.inputError,
          style,
        ]}
      />
      {error || hint ? (
        <Copy
          accessibilityLiveRegion={error ? "polite" : "none"}
          style={error ? styles.fieldError : styles.hint}
        >
          {error ?? hint}
        </Copy>
      ) : null}
    </View>
  );
}

export const layout = StyleSheet.create({
  content: { paddingHorizontal: spaces.xl, paddingBottom: spaces.section },
  intro: { paddingTop: spaces.xl, paddingBottom: spaces.lg, gap: spaces.sm },
  section: { paddingTop: spaces.xl, gap: spaces.md },
  paragraph: { color: colors.muted, lineHeight: 22 },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spaces.sm,
    alignItems: "center",
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, width: "100%", maxWidth, alignSelf: "center" },
  copy: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -1.35,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  button: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: spaces.lg,
    paddingVertical: spaces.md,
    backgroundColor: colors.primary,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spaces.sm,
  },
  buttonText: { fontFamily: fonts.bold, flexShrink: 1, textAlign: "center" },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dim: { opacity: 0.7 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    minHeight: 62,
    paddingHorizontal: spaces.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaces.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spaces.sm,
    flexShrink: 1,
  },
  brandIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandText: {
    fontFamily: fonts.bold,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.55,
  },
  headerLabel: { fontFamily: fonts.bold, flexShrink: 1 },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spaces.xs,
    paddingHorizontal: spaces.md,
    minHeight: 44,
    maxWidth: "46%",
  },
  profileName: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
  notice: {
    padding: spaces.md,
    backgroundColor: colors.tint,
    borderRadius: 8,
    flexDirection: "row",
    gap: spaces.sm,
    alignItems: "flex-start",
  },
  noticeError: { backgroundColor: colors.dangerTint },
  noticeText: { flex: 1, color: colors.primary, fontSize: 14, lineHeight: 20 },
  state: {
    alignItems: "center",
    paddingVertical: spaces.section,
    paddingHorizontal: spaces.xl,
    gap: spaces.md,
  },
  stateIcon: {
    borderRadius: 10,
    width: 46,
    height: 46,
    backgroundColor: colors.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: { fontFamily: fonts.bold, fontSize: 17, textAlign: "center" },
  stateDetail: { color: colors.muted, textAlign: "center" },
  tag: {
    borderRadius: 6,
    paddingVertical: spaces.xs,
    paddingHorizontal: spaces.sm,
    alignSelf: "flex-start",
  },
  tagText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 17 },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spaces.md,
    paddingVertical: spaces.sm,
  },
  chipSelected: { backgroundColor: colors.tint, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  chipTextSelected: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.primary,
  },
  fieldGroup: { gap: 6 },
  label: { fontFamily: fonts.bold, fontSize: 14 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
    paddingHorizontal: spaces.md,
    paddingVertical: spaces.md,
  },
  inputError: { borderColor: colors.danger },
  multiline: { minHeight: 108, textAlignVertical: "top" },
  hint: { color: colors.muted, fontSize: 13 },
  fieldError: { color: colors.danger, fontSize: 13 },
});
