import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { SessionProvider } from "../src/session";
import { colors, fonts } from "../src/theme";
import { Screen, State } from "../src/ui";

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, gcTime: 180_000, retry: false },
  },
});

export default function AppLayout() {
  const [loaded, fontError] = useFonts({
    [fonts.regular]: DMSans_400Regular,
    [fonts.medium]: DMSans_500Medium,
    [fonts.bold]: DMSans_700Bold,
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    const listener = AppState.addEventListener("change", (state) =>
      focusManager.setFocused(state === "active"),
    );
    return () => listener.remove();
  }, []);

  if (!loaded && !fontError)
    return (
      <Screen>
        <State title="Carregando o BairroAtivo" loading />
      </Screen>
    );

  return (
    <QueryClientProvider client={client}>
      <StatusBar style="dark" />
      <SessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </SessionProvider>
    </QueryClientProvider>
  );
}
