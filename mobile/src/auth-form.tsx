import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { credentialsInput, registrationInput } from "@bairroativo/shared";
import type { AuthSession } from "@bairroativo/shared";
import { api } from "./api";
import { spaces } from "./theme";
import {
  Button,
  Copy,
  Field,
  Header,
  Notice,
  Screen,
  Title,
  layout,
} from "./ui";

export function AuthForm({
  onSession,
  expired,
}: {
  onSession: (session: AuthSession) => Promise<void>;
  expired: boolean;
}) {
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const fields = { email, password };
    const credentials = credentialsInput.safeParse(fields);
    const registration = registrationInput.safeParse({ ...fields, name });
    if (!credentials.success || (registering && !registration.success)) {
      setError(
        registering
          ? "Informe seu nome, um e-mail válido e uma senha com pelo menos 8 caracteres."
          : "Informe um e-mail válido e a sua senha.",
      );
      return;
    }

    setError(undefined);
    setBusy(true);
    try {
      const session =
        registering && registration.success
          ? await api.register(registration.data)
          : await api.login(credentials.data);
      await onSession(session);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível acessar a conta.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[layout.content, styles.content]}
          keyboardShouldPersistTaps="handled"
        >
          <Title>{registering ? "Crie sua conta" : "Entre na sua conta"}</Title>
          <Copy style={layout.paragraph}>
            Registre e acompanhe ocorrências no seu bairro.
          </Copy>
          {expired && (
            <Notice message="Sua sessão expirou. Entre novamente para continuar." />
          )}
          {registering && (
            <Field
              label="Nome"
              autoComplete="name"
              value={name}
              onChangeText={setName}
              maxLength={80}
              editable={!busy}
            />
          )}
          <Field
            label="E-mail"
            autoComplete="email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            maxLength={254}
            editable={!busy}
          />
          <Field
            label="Senha"
            secureTextEntry
            autoComplete={registering ? "new-password" : "current-password"}
            value={password}
            onChangeText={setPassword}
            maxLength={128}
            editable={!busy}
            hint={registering ? "Pelo menos 8 caracteres" : undefined}
          />
          {error && <Notice error message={error} />}
          <View style={styles.actions}>
            <Button
              label={registering ? "Criar conta" : "Entrar"}
              busy={busy}
              onPress={() => void submit()}
            />
            <Button
              secondary
              label={registering ? "Já tenho conta" : "Criar uma conta"}
              disabled={busy}
              onPress={() => {
                setRegistering(!registering);
                setError(undefined);
                setPassword("");
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spaces.xl, gap: spaces.lg },
  actions: { gap: spaces.md },
});
