import { Tabs } from "expo-router";
import { Icon } from "../../src/ui";
import { colors, fonts } from "../../src/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Explorar",
          tabBarIcon: ({ focused }) => (
            <Icon
              name="compass"
              color={focused ? colors.primary : colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "Registrar",
          tabBarIcon: ({ focused }) => (
            <Icon
              name="plus-square"
              color={focused ? colors.primary : colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="mine"
        options={{
          title: "Meus registros",
          tabBarIcon: ({ focused }) => (
            <Icon
              name="list"
              color={focused ? colors.primary : colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="metrics"
        options={{
          title: "Indicadores",
          tabBarIcon: ({ focused }) => (
            <Icon
              name="bar-chart-2"
              color={focused ? colors.primary : colors.muted}
              size={21}
            />
          ),
        }}
      />
    </Tabs>
  );
}
