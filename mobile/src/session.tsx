import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import type { AuthSession, UserProfile } from "@bairroativo/shared";
import { api, onSessionExpired } from "./api";
import { AuthForm } from "./auth-form";
import { Screen, State } from "./ui";

const storageKey = "bairroativo.session";
const profileKey = ["profile"];
const SessionContext = createContext<{
  token: string;
  user: UserProfile;
  updateName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
} | null>(null);

async function readToken() {
  if (Platform.OS === "web") return sessionStorage.getItem(storageKey);
  return SecureStore.getItemAsync(storageKey);
}

async function storeToken(token: string | null) {
  if (Platform.OS === "web") {
    if (token) sessionStorage.setItem(storageKey, token);
    else sessionStorage.removeItem(storageKey);
  } else if (token) {
    await SecureStore.setItemAsync(storageKey, token);
  } else {
    await SecureStore.deleteItemAsync(storageKey);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const current = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>();
  const [expired, setExpired] = useState(false);
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: ({ signal }) => api.profile(token!, signal),
    enabled: Boolean(token),
    refetchOnWindowFocus: "always",
  });

  useEffect(() => {
    let active = true;
    void readToken()
      .catch(() => null)
      .then((saved) => {
        if (!active) return;
        current.current = saved;
        setToken(saved);
      });
    return () => {
      active = false;
    };
  }, []);

  const clearSession = useCallback(
    async (expected: string) => {
      if (current.current !== expected) return;
      current.current = null;
      await storeToken(null).catch(() => undefined);
      client.clear();
      setToken(null);
    },
    [client],
  );

  useEffect(
    () =>
      onSessionExpired((invalid) => {
        if (current.current !== invalid) return;
        setExpired(true);
        void clearSession(invalid);
      }),
    [clearSession],
  );

  async function signIn(session: AuthSession) {
    await storeToken(session.token).catch(() => {
      throw new Error("Não foi possível salvar a sessão neste dispositivo.");
    });
    client.clear();
    client.setQueryData(profileKey, session.user);
    current.current = session.token;
    setExpired(false);
    setToken(session.token);
  }

  if (token === undefined || (token && profile.isPending)) {
    return (
      <Screen>
        <State title="Carregando o BairroAtivo" loading />
      </Screen>
    );
  }
  if (!token) return <AuthForm onSession={signIn} expired={expired} />;
  if (!profile.data) {
    return (
      <Screen>
        <State
          title="Não foi possível carregar seu perfil"
          detail={profile.error?.message}
          retry={() => void profile.refetch()}
          icon="alert-circle"
        />
      </Screen>
    );
  }

  return (
    <SessionContext.Provider
      value={{
        token,
        user: profile.data,
        updateName: async (name) => {
          const updated = await api.updateProfile(token, name);
          if (current.current !== token) return;
          client.setQueryData(profileKey, updated);
          void client.invalidateQueries({ queryKey: ["issue"] });
          void client.invalidateQueries({ queryKey: ["issues"] });
        },
        signOut: async () => {
          await api.logout(token);
          await clearSession(token);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is required");
  return context;
}
