import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueDetail } from "@bairroativo/shared";
import { api } from "./api";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: ({ signal }) => api.categories(signal),
    staleTime: 120_000,
  });
}

export function useIssueCache() {
  const client = useQueryClient();
  return (id: number, issueId: string, issue?: IssueDetail) => {
    if (issue) client.setQueryData(["issue", id, issueId], issue);
    else void client.invalidateQueries({ queryKey: ["issue", id, issueId] });
    void client.invalidateQueries({ queryKey: ["issues"] });
    void client.invalidateQueries({ queryKey: ["metrics"] });
    void client.invalidateQueries({ queryKey: ["issue-map"] });
    void client.invalidateQueries({
      queryKey: ["issue"],
      predicate: (query) =>
        query.queryKey[1] !== id && query.queryKey[2] === issueId,
    });
  };
}
