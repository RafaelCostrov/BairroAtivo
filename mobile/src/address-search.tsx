import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import type { AddressMatch } from "@bairroativo/shared";
import { api } from "./api";
import { useSession } from "./session";
import { IssueMapView } from "./issue-map";
import { Button, Copy, Field, Notice, layout } from "./ui";

export function AddressSearch({
  initialQuery,
  onChoose,
  onCancel,
}: {
  initialQuery: string;
  onChoose: (match: AddressMatch) => Promise<void>;
  onCancel: () => void;
}) {
  const { token } = useSession();
  const [query, setQuery] = useState(initialQuery);
  const [matches, setMatches] = useState<AddressMatch[]>();
  const [selected, setSelected] = useState<AddressMatch>();
  const [busy, setBusy] = useState<"search" | "save">();
  const [error, setError] = useState<string>();

  async function search() {
    if (query.trim().length < 8) {
      setError("Informe o endereço, a cidade e o estado para buscar.");
      return;
    }
    setBusy("search");
    setMatches(undefined);
    setSelected(undefined);
    setError(undefined);
    try {
      setMatches(await api.searchAddress(token, query));
    } catch {
      setError(
        "Não foi possível consultar o endereço. Tente novamente em instantes.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function choose() {
    if (!selected) return;
    setBusy("save");
    setError(undefined);
    try {
      await onChoose(selected);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a localização.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <View style={layout.section}>
      <Field
        label="Endereço para buscar no mapa"
        value={query}
        maxLength={300}
        editable={!busy}
        onChangeText={(value) => {
          setQuery(value);
          setMatches(undefined);
          setSelected(undefined);
        }}
        hint="Inclua a cidade e o estado. Só o bairro pode retornar outra região."
      />
      <Button
        secondary
        label="Buscar endereço"
        icon="search"
        onPress={() => void search()}
        busy={busy === "search"}
        disabled={Boolean(busy)}
      />
      {error && <Notice error message={error} />}
      {matches?.length === 0 && (
        <Copy>
          Nenhum local encontrado. Confira o endereço e tente acrescentar a
          cidade e o estado.
        </Copy>
      )}
      {matches?.map((match, index) => (
        <Button
          key={index}
          secondary
          label={match.label}
          disabled={Boolean(busy)}
          onPress={() => setSelected(match)}
        />
      ))}
      {selected && (
        <>
          <Copy>
            Posição aproximada encontrada. Confira o ponto antes de confirmar.
          </Copy>
          <Copy>{selected.neighborhood}</Copy>
          <Copy>{selected.address}</Copy>
          <Copy>
            {selected.postalCode
              ? "CEP " +
                selected.postalCode.slice(0, 5) +
                "-" +
                selected.postalCode.slice(5)
              : "CEP indisponível para este endereço."}
          </Copy>
          <View style={styles.preview}>
            <IssueMapView
              points={[
                {
                  ...selected,
                  id: 0,
                  title: selected.label,
                  neighborhood: "",
                  status: "OPEN",
                },
              ]}
              onOpen={() => setSelected(selected)}
            />
          </View>
          <Button
            label="Usar este ponto"
            onPress={() => void choose()}
            busy={busy === "save"}
            disabled={Boolean(busy)}
          />
        </>
      )}
      <Copy
        accessibilityRole="link"
        onPress={() =>
          void Linking.openURL("https://www.openstreetmap.org/copyright")
        }
      >
        Busca Photon · © OpenStreetMap contributors
      </Copy>
      <Button
        secondary
        label="Fechar busca"
        disabled={Boolean(busy)}
        onPress={onCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 220, overflow: "hidden", borderRadius: 8 },
});
