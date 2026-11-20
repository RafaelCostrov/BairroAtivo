import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { nextStatus } from "@bairroativo/shared";
import type { UserProfile, IssueDetail, Status } from "@bairroativo/shared";
import { AddressSearch } from "../../src/address-search";
import { api } from "../../src/api";
import { useIssueCache } from "../../src/issue-queries";
import { IssueMapView } from "../../src/issue-map";
import { useSession } from "../../src/session";
import {
  colors,
  fonts,
  formatDate,
  severityLabel,
  spaces,
  statusLabel,
} from "../../src/theme";
import {
  Button,
  Copy,
  Field,
  Header,
  Icon,
  Notice,
  Screen,
  SectionTitle,
  State,
  StatusTag,
  Title,
  layout,
} from "../../src/ui";

function IssueContent({
  issue,
  user,
  justCreated,
}: {
  issue: IssueDetail;
  user: UserProfile;
  justCreated: boolean;
}) {
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [addressSearch, setAddressSearch] = useState(false);
  const { token } = useSession();
  const [photoError, setPhotoError] = useState(false);
  const [photoAttempt, setPhotoAttempt] = useState(0);
  const [webPhoto, setWebPhoto] = useState<string>();

  useEffect(() => {
    if (Platform.OS !== "web" || !issue.hasPhoto) return;
    const controller = new AbortController();
    let uri: string | undefined;
    void api
      .photoBlob(token, issue.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        uri = URL.createObjectURL(blob);
        setWebPhoto(uri);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhotoError(true);
      });
    return () => {
      controller.abort();
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [token, issue.id, issue.hasPhoto, photoAttempt]);
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  }>();
  const updateCache = useIssueCache();
  const id = String(issue.id);
  const availableStatus = nextStatus(issue.status);
  const terminal = issue.status === "RESOLVED" || issue.status === "CLOSED";
  const closure = useMutation({
    mutationFn: () => api.closeIssue(token, id, closeNote),
    onSuccess: (updated) => {
      updateCache(user.id, id, updated);
      setClosing(false);
      setCloseNote("");
    },
    onError: () => updateCache(user.id, id),
  });
  const mapPoints = useMemo(
    () =>
      issue.latitude != null && issue.longitude != null
        ? [
            {
              id: issue.id,
              title: issue.title,
              neighborhood: issue.neighborhood,
              status: issue.status,
              latitude: issue.latitude,
              longitude: issue.longitude,
            },
          ]
        : [],
    [
      issue.id,
      issue.title,
      issue.neighborhood,
      issue.status,
      issue.latitude,
      issue.longitude,
    ],
  );

  const confirmation = useMutation({
    mutationFn: (confirmed: boolean) => api.confirm(token, id, confirmed),
    onSuccess: (updated) => {
      updateCache(user.id, id, updated);
      setFeedback({
        message: updated.confirmed
          ? "Confirmação registrada."
          : "Confirmação removida.",
        error: false,
      });
    },
    onError: (error) => {
      updateCache(user.id, id);
      setFeedback({ message: error.message, error: true });
    },
  });
  const status = useMutation({
    mutationFn: (next: Status) => api.changeStatus(token, id, next, note),
    onSuccess: (updated) => {
      updateCache(user.id, id, updated);
      setNote("");
      setFeedback({
        message: "Status atualizado e registrado no histórico.",
        error: false,
      });
    },
    onError: (error) => {
      updateCache(user.id, id);
      setFeedback({ message: error.message, error: true });
    },
  });

  return (
    <>
      <View style={layout.intro}>
        {justCreated && <Notice message="Ocorrência registrada." />}
        {issue.isSample && (
          <Notice message="Ocorrência fictícia para teste ou demonstração. Não representa um problema confirmado neste endereço." />
        )}
        <Copy style={styles.category}>{issue.category.name}</Copy>
        <Title>{issue.title}</Title>
        <View style={layout.wrap}>
          <StatusTag status={issue.status} />
          <Copy style={styles.muted}>
            Gravidade {severityLabel[issue.severity].toLocaleLowerCase("pt-BR")}
          </Copy>
        </View>
        {issue.status === "CLOSED" && (
          <Notice message="Encerrada pelo autor. O registro e o histórico continuam disponíveis para consulta." />
        )}
      </View>
      {issue.hasPhoto &&
        (photoError ? (
          <View style={layout.section}>
            <Notice error message="Não foi possível carregar a foto." />
            <Button
              secondary
              label="Tentar carregar a foto"
              onPress={() => {
                setPhotoError(false);
                setWebPhoto(undefined);
                setPhotoAttempt((previous) => previous + 1);
              }}
            />
          </View>
        ) : Platform.OS === "web" && !webPhoto ? (
          <State title="Carregando foto" loading />
        ) : (
          <Image
            source={webPhoto ? { uri: webPhoto } : api.photo(token, issue.id)}
            resizeMode="contain"
            onError={() => setPhotoError(true)}
            style={styles.photo}
            accessible
            accessibilityLabel="Foto da ocorrência"
          />
        ))}
      <View style={layout.section}>
        {issue.description && (
          <>
            <SectionTitle>Descrição</SectionTitle>
            <Copy>{issue.description}</Copy>
          </>
        )}
        <Copy style={styles.muted}>
          Registrada por {issue.author.name} em{" "}
          {formatDate(issue.createdAt, true)}
        </Copy>
      </View>
      <View style={layout.section}>
        <SectionTitle>Local</SectionTitle>
        <View style={styles.location}>
          <Icon name="map-pin" />
          <View style={styles.locationText}>
            <Copy style={styles.emphasis}>{issue.neighborhood}</Copy>
            <Copy>{issue.address}</Copy>
            {issue.postalCode && (
              <Copy style={styles.muted}>
                CEP {issue.postalCode.slice(0, 5)}-{issue.postalCode.slice(5)}
              </Copy>
            )}
            {issue.latitude != null && issue.longitude != null && (
              <Copy style={styles.muted}>
                Lat.{" "}
                {issue.latitude.toLocaleString("pt-BR", {
                  maximumFractionDigits: 7,
                })}
                {" · Long. "}
                {issue.longitude.toLocaleString("pt-BR", {
                  maximumFractionDigits: 7,
                })}
              </Copy>
            )}
            {issue.latitude === null &&
              issue.author.id !== user.id &&
              user.role !== "OPERATOR" && (
                <Copy style={styles.muted}>
                  O autor ou um agente pode localizar esta ocorrência pelo
                  endereço.
                </Copy>
              )}
          </View>
        </View>
        {mapPoints.length > 0 && (
          <View style={styles.map}>
            <IssueMapView
              points={mapPoints}
              label="Local da ocorrência no mapa"
            />
          </View>
        )}
      </View>
      {issue.latitude === null &&
        (issue.author.id === user.id || user.role === "OPERATOR") && (
          <View style={layout.section}>
            <Button
              secondary
              label="Localizar pelo endereço"
              icon="map-pin"
              onPress={() => setAddressSearch(true)}
            />
            {addressSearch && (
              <AddressSearch
                initialQuery={[
                  issue.address,
                  issue.neighborhood,
                  issue.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ")}
                onCancel={() => setAddressSearch(false)}
                onChoose={async (point) => {
                  const updated = await api.locateIssue(token, id, point);
                  updateCache(user.id, id, updated);
                  setAddressSearch(false);
                }}
              />
            )}
          </View>
        )}
      <View style={layout.section}>
        <SectionTitle>Confirmações e prioridade</SectionTitle>
        <View style={styles.scoreBox}>
          <Copy style={styles.emphasis}>
            {issue.confirmationCount}{" "}
            {issue.confirmationCount === 1 ? "confirmação" : "confirmações"}
          </Copy>
          <Copy style={styles.emphasis}>Prioridade {issue.priorityScore}</Copy>
          <Copy style={styles.muted}>
            Gravidade: {issue.severityPoints} pontos. Confirmações:{" "}
            {issue.priorityScore - issue.severityPoints} pontos.
          </Copy>
        </View>
        {user.role === "CITIZEN" &&
          (terminal && !issue.confirmed ? (
            <Copy style={styles.muted}>
              Ocorrências resolvidas ou encerradas não recebem novas
              confirmações.
            </Copy>
          ) : (
            <Button
              label={
                issue.confirmed
                  ? "Remover minha confirmação"
                  : "Confirmar que o problema continua"
              }
              onPress={() => {
                setFeedback(undefined);
                confirmation.mutate(issue.confirmed);
              }}
              secondary={issue.confirmed}
              icon={issue.confirmed ? "minus-circle" : "check-circle"}
              busy={confirmation.isPending}
            />
          ))}
        {user.role === "CITIZEN" && feedback && <Notice {...feedback} />}
      </View>
      {issue.author.id === user.id && !terminal && (
        <View style={layout.section}>
          <SectionTitle>Sua ocorrência</SectionTitle>
          {closing ? (
            <>
              <Copy>
                A ocorrência continuará disponível para consulta, com o
                encerramento registrado no histórico.
              </Copy>
              <Field
                label="Motivo do encerramento (opcional)"
                value={closeNote}
                onChangeText={setCloseNote}
                multiline
                maxLength={500}
                editable={!closure.isPending}
              />
              <Button
                label="Confirmar encerramento"
                onPress={() => closure.mutate()}
                busy={closure.isPending}
              />
              <Button
                secondary
                label="Continuar acompanhamento"
                onPress={() => {
                  setClosing(false);
                  closure.reset();
                }}
                disabled={closure.isPending}
              />
            </>
          ) : (
            <Button
              secondary
              label="Encerrar minha ocorrência"
              onPress={() => setClosing(true)}
            />
          )}
          {closure.isError && <Notice error message={closure.error.message} />}
        </View>
      )}
      {user.role === "OPERATOR" && (
        <View style={layout.section}>
          <SectionTitle>Atualizar acompanhamento</SectionTitle>
          {availableStatus ? (
            <>
              <Field
                label="Observação (opcional)"
                onChangeText={setNote}
                value={note}
                multiline
                maxLength={500}
                editable={!status.isPending}
              />
              <Button
                label={
                  availableStatus === "IN_PROGRESS"
                    ? "Iniciar acompanhamento"
                    : "Marcar como resolvida"
                }
                onPress={() => {
                  setFeedback(undefined);
                  status.mutate(availableStatus);
                }}
                busy={status.isPending}
              />
            </>
          ) : (
            <Copy style={styles.muted}>
              O acompanhamento desta ocorrência foi encerrado na plataforma.
            </Copy>
          )}
          {feedback && <Notice {...feedback} />}
        </View>
      )}
      <View style={layout.section}>
        <SectionTitle>Histórico de acompanhamento</SectionTitle>
        {issue.history.length === 0 && (
          <Copy style={styles.muted}>Nenhuma alteração registrada.</Copy>
        )}
        {issue.history.map((entry) => (
          <View key={entry.id} style={[styles.history, layout.divider]}>
            <Icon name={entry.previousStatus ? "activity" : "flag"} size={17} />
            <View style={styles.historyText}>
              <Copy style={styles.emphasis}>
                {entry.previousStatus
                  ? statusLabel[entry.previousStatus] +
                    " → " +
                    statusLabel[entry.status]
                  : "Ocorrência registrada"}
              </Copy>
              <Copy style={styles.muted}>
                {entry.actorName} · {formatDate(entry.createdAt, true)}
              </Copy>
              {entry.note && <Copy>{entry.note}</Copy>}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

export default function IssueScreen() {
  const { id, created } = useLocalSearchParams<{
    id: string;
    created?: string;
  }>();
  const { token, user } = useSession();
  const query = useQuery({
    queryKey: ["issue", user.id, id],
    queryFn: ({ signal }) => api.issue(token, id, signal),
  });

  return (
    <Screen>
      <Header back label="Ocorrência" userName={user.name} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={layout.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              colors={[colors.primary]}
              tintColor={colors.primary}
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        >
          {query.data ? (
            <>
              {query.isRefetchError && (
                <Notice
                  error
                  message="Não foi possível atualizar a ocorrência."
                />
              )}
              <IssueContent
                key={user.id + ":" + id}
                issue={query.data}
                user={user}
                justCreated={
                  created === "1" && query.data.author.id === user.id
                }
              />
            </>
          ) : query.isPending ? (
            <State title="Carregando ocorrência" loading />
          ) : (
            <State
              title="Ocorrência indisponível"
              detail={query.error.message}
              retry={() => void query.refetch()}
              icon="alert-circle"
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  category: { fontFamily: fonts.bold, color: colors.primary },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  emphasis: { fontFamily: fonts.bold },
  photo: {
    width: "100%",
    height: 250,
    borderRadius: 10,
    backgroundColor: colors.tint,
  },
  location: { flexDirection: "row", gap: spaces.sm, alignItems: "flex-start" },
  locationText: { flex: 1, gap: spaces.xs },
  map: { height: 250, borderRadius: 10, overflow: "hidden" },
  scoreBox: {
    padding: spaces.lg,
    gap: spaces.xs,
    backgroundColor: colors.tint,
    borderRadius: 9,
  },
  history: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spaces.md,
    paddingBottom: spaces.md,
  },
  historyText: { flex: 1, gap: spaces.xs },
});
