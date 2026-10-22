import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { adminAuditLogs, adminWalletTransactions } from "@/lib/admin.functions";

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(value);

export function AdminWalletTransactions() {
  const loadTransactions = useServerFn(adminWalletTransactions);
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminWalletTransactions>> | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadTransactions({ data: { page, pageSize: 25 } })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Wallet transactions could not load.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadTransactions, page, refresh]);

  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 25));
  return (
    <section aria-labelledby="admin-wallet-transactions-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-wallet-transactions-heading" className="text-2xl font-semibold">
            Wallet Transactions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Financial ledger entries from the actual wallet transaction table.
          </p>
        </div>
        <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
      {error && (
        <p className="mt-4 rounded-md border border-destructive p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          Loading wallet transactions…
        </p>
      ) : result?.transactions.length ? (
        <>
          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">User</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Balance after</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Reference / reason</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.map((transaction) => (
                  <tr key={transaction.id} className="border-t border-border">
                    <td className="p-3">{new Date(transaction.created_at).toLocaleString()}</td>
                    <td className="p-3">
                      <p>{transaction.profile?.display_name || "Marketplace user"}</p>
                      <p className="text-xs text-muted-foreground">
                        {transaction.profile?.email ?? transaction.user_id}
                      </p>
                    </td>
                    <td className="p-3 capitalize">{transaction.type}</td>
                    <td className="p-3">{money(Number(transaction.amount))}</td>
                    <td className="p-3">{money(Number(transaction.balance_after))}</td>
                    <td className="p-3 capitalize">{transaction.status}</td>
                    <td className="p-3">
                      <p className="max-w-64 break-all font-mono text-xs">
                        {transaction.reference ?? "—"}
                      </p>
                      <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground">
                        {transaction.description ?? "—"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} total={result.total} onPage={setPage} />
        </>
      ) : (
        !error && (
          <p className="mt-5 rounded-md border border-border p-5 text-sm text-muted-foreground">
            No wallet transactions recorded.
          </p>
        )
      )}
    </section>
  );
}

export function AdminAuditLogs() {
  const loadAudit = useServerFn(adminAuditLogs);
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminAuditLogs>> | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadAudit({ data: { page, pageSize: 25 } })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Audit logs could not load.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAudit, page, refresh]);

  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 25));
  return (
    <section aria-labelledby="admin-audit-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="admin-audit-heading" className="text-2xl font-semibold">
            Audit Logs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Administrative actions are read-only and retained with their relevant before-and-after
            metadata.
          </p>
        </div>
        <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
      {error && (
        <p className="mt-4 rounded-md border border-destructive p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          Loading audit logs…
        </p>
      ) : result?.logs.length ? (
        <>
          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Administrator</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Record</th>
                  <th className="p-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {result.logs.map((log) => (
                  <tr key={log.id} className="border-t border-border align-top">
                    <td className="p-3">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="p-3">{log.actor_name}</td>
                    <td className="p-3 font-mono text-xs">{log.action}</td>
                    <td className="p-3 break-all font-mono text-xs">{log.target ?? "—"}</td>
                    <td className="max-w-sm p-3">
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} total={result.total} onPage={setPage} />
        </>
      ) : (
        !error && (
          <p className="mt-5 rounded-md border border-border p-5 text-sm text-muted-foreground">
            No audit records yet.
          </p>
        )
      )}
    </section>
  );
}

function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {total} record{total === 1 ? "" : "s"} · Page {page} of {pages}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
