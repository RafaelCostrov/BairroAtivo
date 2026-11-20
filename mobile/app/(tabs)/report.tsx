import { View } from "react-native";
import { useSession } from "../../src/session";
import { ReportForm } from "../../src/report-form";
import { Header, Screen, State, Title, layout } from "../../src/ui";

export default function Report() {
  const { user } = useSession();
  return (
    <Screen tab>
      <Header userName={user.name} />
      <View style={[layout.content, layout.intro]}>
        <Title>Registrar ocorrência</Title>
      </View>
      {user.role === "CITIZEN" ? (
        <ReportForm key={user.id} />
      ) : (
        <State
          title="Registro disponível para moradores"
          detail="Use sua conta de agente para acompanhar as ocorrências."
          icon="user"
        />
      )}
    </Screen>
  );
}
