import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { issuePageSize, statuses } from "@bairroativo/shared";
import type { Issue, IssueMap, IssueStatusFilter } from "@bairroativo/shared";
import { api } from "./api";
import { useCategories } from "./issue-queries";
import {
  issueDateText as dateText,
  parseIssueDateRange as parseDateRange,
  maskIssueDate,
} from "@bairroativo/shared";
import { IssueMapView } from "./issue-map";
import { useSession } from "./session";
import type { IconName } from "./ui";
import {
  Button,
  Chip,
  Copy,
  Header,
  Field,
  Icon,
  IconButton,
  Notice,
  Screen,
  SectionTitle,
  State,
  StatusTag,
  Title,
  layout,
} from "./ui";
import {
  colors,
  fonts,
  formatDate,
  maxWidth,
  spaces,
  statusLabel,
} from "./theme";

const categoryIcons: Record<string, IconName> = {
  ROADS: "truck",
  LIGHTING: "sun",
  SIDEWALKS: "navigation",
  WASTE: "trash-2",
  DRAINAGE: "droplet",
  PUBLIC_EQUIPMENT: "tool",
};

function IssueRow({ issue, onPress }: { issue: Issue; onPress: () => void }) {
  const confirmations =
    issue.confirmationCount === 1
      ? "1 confirmação"
      : issue.confirmationCount + " confirmações";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${issue.title}. ${issue.category.name}. ${statusLabel[issue.status]}. ${issue.neighborhood}. ${confirmations}. Prioridade ${issue.priorityScore} pontos.`}
      style={({ pressed }) => [
        styles.row,
        layout.divider,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topicIcon}>
        <Icon name={categoryIcons[issue.category.code] ?? "flag"} size={19} />
      </View>
      <View style={styles.rowBody}>
        <Copy style={styles.category}>{issue.category.name}</Copy>
        <Copy style={styles.issueTitle} numberOfLines={2}>
          {issue.title}
        </Copy>
        <View style={styles.metadata}>
          <Icon name="map-pin" size={14} color={colors.muted} />
          <Copy style={styles.metaText} numberOfLines={1}>
            {issue.neighborhood}
          </Copy>
          <Copy style={styles.metaText}>· {formatDate(issue.createdAt)}</Copy>
        </View>
        <View style={layout.wrap}>
          <StatusTag status={issue.status} />
          {issue.isSample && <Copy style={styles.metaText}>Exemplo</Copy>}
          <View style={styles.confirmations}>
            <Icon
              name="check-circle"
              size={14}
              color={issue.confirmed ? colors.primary : colors.muted}
            />
            <Copy style={styles.metaText}>{issue.confirmationCount}</Copy>
          </View>
          <View style={styles.priority}>
            <Icon name="activity" size={13} color={colors.primary} />
            <Copy style={styles.priorityText}>
              Prioridade {issue.priorityScore}
            </Copy>
          </View>
        </View>
      </View>
      <Icon name="chevron-right" color={colors.muted} size={17} />
    </Pressable>
  );
}

export function IssueList({ mine = false }: { mine?: boolean }) {
  const { token, user } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<number>();
  const [status, setStatus] = useState<IssueStatusFilter>();
  const [order, setOrder] = useState<"recent" | "priority">("recent");
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const categories = useCategories();
  const [focusVersion, setFocusVersion] = useState(0);
  const [refreshing, setRefreshing] = useState<{ key: string; id: number }>();
  const refreshId = useRef(0);
  useFocusEffect(
    useCallback(() => {
      setFocusVersion((version) => version + 1);
      setRefreshing(undefined);
      return () => {
        refreshId.current += 1;
      };
    }, []),
  );
  const [range, setRange] = useState<{ startDate?: string; endDate?: string }>(
    {},
  );
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [dateError, setDateError] = useState<string>();
  const filterKey = JSON.stringify([
    mine,
    term,
    category,
    status,
    order,
    range,
  ]);
  const [page, setPage] = useState({ filterKey, offset: 0 });
  const offset = page.filterKey === filterKey ? page.offset : 0;
  const listKey = filterKey + ":" + offset + ":" + focusVersion;

  function changePage(nextOffset: number) {
    setPage({ filterKey, offset: nextOffset });
  }

  useEffect(() => {
    const parsed = parseDateRange(dateStart, dateEnd);
    if (!parsed.success) {
      const incomplete = [dateStart, dateEnd].some(
        (value) => value.length > 0 && value.length < 10,
      );
      setDateError(
        incomplete
          ? undefined
          : "Use datas válidas. A data final deve ser igual ou posterior à inicial.",
      );
      return;
    }
    setDateError(undefined);
    const update = setTimeout(() => setRange(parsed.data), 300);
    return () => clearTimeout(update);
  }, [dateStart, dateEnd]);

  useEffect(() => {
    const update = setTimeout(() => setTerm(search.trim()), 260);
    return () => clearTimeout(update);
  }, [search]);

  function filters() {
    const params = new URLSearchParams({ mine: String(mine) });
    if (term.length) params.set("search", term);
    if (category) params.set("category", String(category));
    if (status) params.set("status", status);
    if (range.startDate) params.set("startDate", range.startDate);
    if (range.endDate) params.set("endDate", range.endDate);
    return params;
  }

  const openIssue = useCallback(
    (id: number) => {
      router.push({ pathname: "/issues/[id]", params: { id: String(id) } });
    },
    [router],
  );

  const map = useInfiniteQuery({
    queryKey: ["issue-map", user.id, mine, term, category, status, range],
    initialPageParam: 0,
    getNextPageParam: (page: IssueMap) => page.nextOffset ?? undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = filters();
      params.set("offset", String(pageParam));
      return api.issueMap(token, params, signal);
    },
    enabled: showMap,
  });

  const mapPoints = map.data?.pages.flatMap((page) => page.points) ?? [];
  const unlocated = map.data?.pages[0].unlocated ?? [];

  const result = useQuery({
    enabled: !showMap,
    queryKey: [
      "issues",
      user.id,
      mine,
      term,
      category,
      status,
      order,
      range,
      offset,
    ],
    queryFn: ({ signal }) => {
      const params = filters();
      params.set("offset", String(offset));
      params.set("limit", String(issuePageSize));
      params.set("order", order);
      return api.issues(token, params, signal);
    },
  });

  const issues = result.data?.items ?? [];
  async function refresh() {
    if (refreshing?.key === listKey) return;
    const id = ++refreshId.current;
    setRefreshing({ key: listKey, id });
    try {
      await result.refetch();
    } catch {
      return;
    } finally {
      if (refreshId.current === id)
        setRefreshing((current) => (current?.id === id ? undefined : current));
    }
  }
  const filterCount =
    Number(Boolean(category)) +
    Number(Boolean(status)) +
    Number(Boolean(range.startDate || range.endDate));

  function clear() {
    setCategory(undefined);
    setStatus(undefined);
    setRange({});
    setDateStart("");
    setDateEnd("");
    setDateError(undefined);
  }

  return (
    <Screen tab>
      <Header userName={user.name} />
      <View style={[layout.content, styles.controls]}>
        <Title>{mine ? "Meus registros" : "Ocorrências no bairro"}</Title>
        {mine ? (
          <Copy style={layout.paragraph}>Registros de {user.name}.</Copy>
        ) : null}
        <View style={styles.search}>
          <Icon name="search" size={19} color={colors.muted} />
          <TextInput
            accessibilityLabel="Buscar ocorrências"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            placeholder="Buscar por problema, região ou CEP"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="search"
            maxLength={100}
            onSubmitEditing={() => setTerm(search.trim())}
          />
          {search.length > 0 && (
            <IconButton
              name="x"
              label="Limpar busca"
              onPress={() => {
                setSearch("");
                setTerm("");
              }}
            />
          )}
        </View>
        <View style={styles.tools}>
          {!showMap && (
            <View style={styles.order}>
              <Chip
                label="Mais recentes"
                selected={order === "recent"}
                onPress={() => setOrder("recent")}
              />
              <Chip
                label="Prioridade"
                selected={order === "priority"}
                onPress={() => setOrder("priority")}
              />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              filterCount ? "Filtros, " + filterCount + " ativos" : "Filtros"
            }
            onPress={() => {
              setDateStart(dateText(range.startDate));
              setDateEnd(dateText(range.endDate));
              setDateError(undefined);
              setShowFilters(true);
            }}
            style={({ pressed }) => [
              styles.filterButton,
              pressed && styles.pressed,
            ]}
          >
            <Icon name="sliders" size={16} />
            <Copy style={styles.filterLabel}>
              Filtros{filterCount ? " · " + filterCount : ""}
            </Copy>
          </Pressable>
        </View>
        {!mine && (
          <View style={styles.order}>
            <Chip
              label="Lista"
              selected={!showMap}
              onPress={() => setShowMap(false)}
            />
            <Chip
              label="Mapa"
              selected={showMap}
              onPress={() => setShowMap(true)}
            />
          </View>
        )}
        {filterCount > 0 && (
          <View style={layout.wrap}>
            {(range.startDate || range.endDate) && (
              <Chip
                label={
                  (dateText(range.startDate) || "Início") +
                  " – " +
                  (dateText(range.endDate) || "em diante") +
                  " ×"
                }
                selected
                onPress={() => {
                  setRange({});
                  setDateStart("");
                  setDateEnd("");
                }}
              />
            )}
            {status && (
              <Chip
                label={
                  (status === "ALL" ? "Todos os status" : statusLabel[status]) +
                  " ×"
                }
                selected
                onPress={() => setStatus(undefined)}
              />
            )}
            {category && (
              <Chip
                label={
                  (categories.data?.find(({ id }) => id === category)?.name ??
                    "Categoria") + " ×"
                }
                selected
                onPress={() => setCategory(undefined)}
              />
            )}
          </View>
        )}
      </View>
      {showMap ? (
        <View style={[layout.content, styles.map]}>
          {map.isPending ? (
            <State title="Carregando mapa" loading />
          ) : map.isError && !map.data ? (
            <State
              title="Mapa indisponível"
              detail={map.error.message}
              retry={() => void map.refetch()}
              icon="alert-circle"
            />
          ) : (
            <>
              <Copy style={layout.paragraph}>
                {mapPoints.length
                  ? "Toque em um marcador para abrir a ocorrência."
                  : "Nenhuma ocorrência encontrada para estes filtros."}
              </Copy>
              <IssueMapView points={mapPoints} onOpen={openIssue} />
              {map.hasNextPage && (
                <Button
                  secondary
                  label={
                    map.isFetchNextPageError
                      ? "Tentar carregar mais no mapa"
                      : "Carregar mais no mapa"
                  }
                  busy={map.isFetchingNextPage}
                  onPress={() => void map.fetchNextPage()}
                />
              )}
              {unlocated.length > 0 && (
                <ScrollView
                  style={styles.unlocated}
                  contentContainerStyle={{ gap: spaces.sm }}
                >
                  <Copy style={layout.paragraph}>
                    Sem ponto no mapa. Abra para localizar pelo endereço.
                  </Copy>
                  {unlocated.map((issue) => (
                    <Button
                      key={issue.id}
                      secondary
                      label={issue.title}
                      onPress={() => openIssue(issue.id)}
                    />
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      ) : (
        <FlatList
          key={listKey}
          data={issues}
          keyExtractor={(issue) => String(issue.id)}
          renderItem={({ item }) => (
            <IssueRow issue={item} onPress={() => openIssue(item.id)} />
          )}
          contentContainerStyle={layout.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              colors={[colors.primary]}
              tintColor={colors.primary}
              refreshing={refreshing?.key === listKey}
              onRefresh={() => void refresh()}
            />
          }
          ListHeaderComponent={
            result.isRefetchError && issues.length > 0 ? (
              <Notice
                error
                message="Não foi possível atualizar os registros. Puxe a lista para tentar novamente."
              />
            ) : undefined
          }
          ListEmptyComponent={
            result.isPending ? (
              <State title="Carregando ocorrências" loading />
            ) : result.isError ? (
              <State
                title="Não foi possível carregar"
                detail={result.error.message}
                retry={() => void result.refetch()}
                icon="wifi-off"
              />
            ) : (
              <State
                title={
                  mine && !term && !filterCount
                    ? "Você ainda não tem registros"
                    : "Nenhuma ocorrência encontrada"
                }
                detail={
                  term || filterCount
                    ? "Experimente ajustar a busca ou os filtros."
                    : "As ocorrências registradas aparecem aqui."
                }
              />
            )
          }
          ListFooterComponent={
            result.data ? (
              <View style={styles.pagination}>
                <Button
                  secondary
                  label="Anterior"
                  onPress={() =>
                    changePage(Math.max(0, offset - issuePageSize))
                  }
                  disabled={offset === 0 || result.isFetching}
                />
                <Copy accessibilityLiveRegion="polite">
                  Página {Math.floor(offset / issuePageSize) + 1}
                </Copy>
                <Button
                  secondary
                  label="Próxima"
                  onPress={() => {
                    if (result.data.nextOffset !== null)
                      changePage(result.data.nextOffset);
                  }}
                  disabled={
                    result.data.nextOffset === null || result.isFetching
                  }
                />
              </View>
            ) : undefined
          }
        />
      )}
      <Modal
        visible={showFilters}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilters(false)}
      >
        <SafeAreaView style={styles.modal} accessibilityViewIsModal>
          <View style={styles.modalInner}>
            <View style={[styles.modalHeader, layout.divider]}>
              <SectionTitle>Filtros</SectionTitle>
              <IconButton
                label="Fechar filtros"
                name="x"
                onPress={() => setShowFilters(false)}
              />
            </View>
            <ScrollView contentContainerStyle={layout.content}>
              <View style={layout.section}>
                <SectionTitle>Status</SectionTitle>
                <View style={layout.wrap}>
                  {!mine && (
                    <Chip
                      label="Sem encerradas"
                      selected={!status}
                      onPress={() => setStatus(undefined)}
                    />
                  )}
                  <Chip
                    label="Todos"
                    selected={status === "ALL" || (mine && !status)}
                    onPress={() => setStatus(mine ? undefined : "ALL")}
                  />
                  {statuses.map((value) => (
                    <Chip
                      key={value}
                      label={statusLabel[value]}
                      selected={status === value}
                      onPress={() => setStatus(value)}
                    />
                  ))}
                </View>
              </View>
              <View style={layout.section}>
                <SectionTitle>Categoria</SectionTitle>
                {categories.isPending ? (
                  <ActivityIndicator color={colors.primary} />
                ) : categories.isError ? (
                  <State
                    title="Categorias indisponíveis"
                    detail={categories.error.message}
                    retry={() => void categories.refetch()}
                  />
                ) : (
                  <View style={layout.wrap}>
                    <Chip
                      label="Todas"
                      selected={!category}
                      onPress={() => setCategory(undefined)}
                    />
                    {categories.data.map(({ id, name }) => (
                      <Chip
                        key={id}
                        label={name}
                        selected={category === id}
                        onPress={() => setCategory(id)}
                      />
                    ))}
                  </View>
                )}
              </View>
              <View style={layout.section}>
                <SectionTitle>Data de registro</SectionTitle>
                <Field
                  label="De"
                  placeholder="DD/MM/AAAA"
                  value={dateStart}
                  onChangeText={(value) => setDateStart(maskIssueDate(value))}
                  maxLength={10}
                  keyboardType="number-pad"
                  inputMode="numeric"
                />
                <Field
                  label="Até"
                  placeholder="DD/MM/AAAA"
                  value={dateEnd}
                  onChangeText={(value) => setDateEnd(maskIssueDate(value))}
                  maxLength={10}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  hint="O filtro é atualizado automaticamente ao completar a data. Datas inclusivas no horário de Brasília."
                />
                {dateError && <Notice error message={dateError} />}
                <Button
                  label="Concluir"
                  onPress={() => {
                    if (
                      !dateError &&
                      [dateStart, dateEnd].every(
                        (value) => !value || value.length === 10,
                      )
                    )
                      setShowFilters(false);
                  }}
                />
                {filterCount > 0 && (
                  <Button label="Limpar filtros" onPress={clear} secondary />
                )}
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  unlocated: { gap: spaces.sm, maxHeight: 190 },
  pagination: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaces.sm,
    paddingVertical: spaces.lg,
  },
  map: { flex: 1, gap: spaces.sm },
  controls: { paddingTop: spaces.xl, paddingBottom: spaces.md, gap: spaces.md },
  search: {
    minHeight: 48,
    borderRadius: 9,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spaces.md,
    gap: spaces.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingRight: spaces.sm,
  },
  tools: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaces.sm,
  },
  order: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spaces.xs,
    flexShrink: 1,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spaces.sm,
    paddingHorizontal: spaces.md,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  filterLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spaces.md,
    paddingVertical: spaces.lg,
  },
  rowBody: { flex: 1, gap: 6, minWidth: 0 },
  topicIcon: {
    width: 39,
    height: 39,
    borderRadius: 9,
    backgroundColor: colors.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  category: {
    color: colors.primary,
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 17,
  },
  issueTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  pressed: { opacity: 0.64 },
  metadata: { flexDirection: "row", alignItems: "center", gap: spaces.xs },
  metaText: {
    flexShrink: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  confirmations: { flexDirection: "row", alignItems: "center", gap: spaces.xs },
  priority: {
    flexDirection: "row",
    alignItems: "center",
    gap: spaces.xs,
    backgroundColor: colors.tint,
    paddingHorizontal: spaces.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  footer: { paddingVertical: spaces.lg },
  modal: { flex: 1, backgroundColor: colors.background },
  modalInner: { width: "100%", maxWidth, flex: 1, alignSelf: "center" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spaces.xl,
  },
});
