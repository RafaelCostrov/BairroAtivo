import { useQuery } from "@tanstack/react-query";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { api } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, fonts, spaces } from "../../src/theme";
import {
  Copy,
  Header,
  Notice,
  Screen,
  SectionTitle,
  State,
  Title,
  layout,
} from "../../src/ui";

function Breakdown({
  label,
  items,
}: {
  label: string;
  items: { name: string; count: number }[];
}) {
  const highest = Math.max(...items.map(({ count }) => count), 1);
  return (
    <View style={layout.section}>
      <SectionTitle>{label}</SectionTitle>
      {items.map(({ name, count }) => (
        <View
          key={name}
          style={styles.metricRow}
          accessible
          accessibilityLabel={
            name + ", " + count + (count === 1 ? " ocorrência" : " ocorrências")
          }
        >
          <View style={styles.between}>
            <Copy style={styles.metricName}>{name}</Copy>
            <Copy style={styles.metricCount}>{count}</Copy>
          </View>
          <View style={styles.track}>
            <View
              style={[styles.fill, { width: `${(count / highest) * 100}%` }]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function CommunityMetrics() {
  const { token, user } = useSession();
  const query = useQuery({
    queryKey: ["metrics", user.id],
    queryFn: ({ signal }) => api.metrics(token, signal),
  });
  const metrics = query.data;
  const statuses = metrics && [
    { label: "Abertas", count: metrics.open },
    { label: "Em acompanhamento", count: metrics.inProgress },
    { label: "Resolvidas", count: metrics.resolved },
    { label: "Encerradas pelo autor", count: metrics.closed },
  ];

  return (
    <Screen tab>
      <Header userName={user.name} />
      <ScrollView
        contentContainerStyle={layout.content}
        refreshControl={
          <RefreshControl
            colors={[colors.primary]}
            tintColor={colors.primary}
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
          />
        }
      >
        <View style={layout.intro}>
          <Title>Indicadores comunitários</Title>
          <Copy style={layout.paragraph}>
            Totais da plataforma, incluindo os registros de exemplo.
          </Copy>
        </View>
        {!metrics ? (
          query.isPending ? (
            <State title="Calculando indicadores" loading />
          ) : (
            <State
              title="Indicadores indisponíveis"
              detail={query.error.message}
              retry={() => void query.refetch()}
              icon="wifi-off"
            />
          )
        ) : (
          <>
            {query.isRefetchError && (
              <Notice
                error
                message="Não foi possível atualizar os indicadores."
              />
            )}
            <View style={styles.total}>
              <Copy style={styles.totalLabel}>Total de ocorrências</Copy>
              <Copy style={styles.totalNumber}>{metrics.total}</Copy>
            </View>
            <View style={styles.statuses}>
              {statuses?.map(({ label, count }) => (
                <View key={label} style={[styles.statusRow, layout.divider]}>
                  <Copy style={styles.metricName}>{label}</Copy>
                  <Copy style={styles.metricCount}>{count}</Copy>
                </View>
              ))}
            </View>
            {metrics.total === 0 ? (
              <State title="Nenhuma ocorrência registrada" />
            ) : (
              <>
                <Breakdown label="Por categoria" items={metrics.categories} />
                <Breakdown
                  label="Bairros com mais registros"
                  items={metrics.neighborhoods}
                />
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: {
    backgroundColor: colors.primary,
    borderRadius: 11,
    padding: spaces.xl,
    gap: spaces.sm,
  },
  totalLabel: { color: "#E4F3E9", fontFamily: fonts.medium },
  totalNumber: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: 52,
    lineHeight: 57,
  },
  statuses: { paddingTop: spaces.sm },
  statusRow: {
    minHeight: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spaces.md,
  },
  metricRow: { gap: spaces.xs, marginBottom: spaces.xs },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaces.md,
  },
  metricName: { flexShrink: 1, fontFamily: fonts.medium },
  metricCount: { fontFamily: fonts.bold, fontVariant: ["tabular-nums"] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border },
  fill: { height: "100%", backgroundColor: colors.primary, borderRadius: 3 },
});
