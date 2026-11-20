import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { profileInput } from "@bairroativo/shared";
import { useSession } from "../src/session";
import { spaces } from "../src/theme";
import {
  Button,
  Copy,
  Field,
  Header,
  Notice,
  Screen,
  Title,
  layout,
} from "../src/ui";

export default function Profile() {
  const { user, updateName, signOut } = useSession();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState<"save" | "logout">();
  const [feedback, setFeedback] = useState<{
    message: string;
    error?: boolean;
  }>();

  async function save() {
    const input = profileInput.safeParse({ name });
    if (!input.success) {
      setFeedback({
        message: "Informe um nome com pelo menos 2 caracteres.",
        error: true,
      });
      return;
    }
    setBusy("save");
    setFeedback(undefined);
    try {
      await updateName(input.data.name);
      setName(input.data.name);
      setFeedback({ message: "Perfil atualizado." });
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar o perfil.",
        error: true,
      });
    } finally {
      setBusy(undefined);
    }
  }

  async function logout() {
    setBusy("logout");
    setFeedback(undefined);
    try {
      await signOut();
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível sair da conta.",
        error: true,
      });
      setBusy(undefined);
    }
  }

  return (
    <Screen>
      <Header back label="Perfil" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[layout.content, styles.content]}
          keyboardShouldPersistTaps="handled"
        >
          <Title>Meu perfil</Title>
          <Copy style={layout.paragraph}>
            {user.role === "OPERATOR" ? "Agente comunitário" : "Morador"}
          </Copy>
          <Field
            label="Nome"
            value={name}
            onChangeText={setName}
            editable={!busy}
            maxLength={80}
          />
          <Field label="E-mail" value={user.email} editable={false} />
          {feedback && <Notice {...feedback} />}
          <Button
            label="Salvar nome"
            onPress={() => void save()}
            busy={busy === "save"}
            disabled={busy === "logout" || name.trim() === user.name}
          />
          <Button
            secondary
            label="Sair da conta"
            icon="log-out"
            onPress={() => void logout()}
            busy={busy === "logout"}
            disabled={busy === "save"}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spaces.xl, gap: spaces.lg },
});
