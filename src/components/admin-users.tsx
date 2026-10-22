import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminAdjustWallet,
  adminSearchUsers,
  adminSetUserState,
  adminUserDetails,
} from "@/lib/admin.functions";
import { useAuthUser } from "@/hooks/use-auth-user";

type UserResult = Awaited<ReturnType<typeof adminSearchUsers>>;
type AdminUser = UserResult["users"][number];
type UserDetails = Awaited<ReturnType<typeof adminUserDetails>>;
type PendingAction = { action: "suspend" | "deactivate" | "restore"; user: AdminUser } | null;

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(value);

export function AdminUsers() {
  const { user: currentUser } = useAuthUser();
  const searchUsers = useServerFn(adminSearchUsers);
  const fetchUserDetails = useServerFn(adminUserDetails);
  const adjustWallet = useServerFn(adminAdjustWallet);
  const changeUserState = useServerFn(adminSetUserState);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended" | "deactivated">("all");
  const [role, setRole] = useState<"all" | "user" | "admin">("all");
  const [page, setPage] = useState(1);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [result, setResult] = useState<UserResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionReason, setActionReason] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [walletAction, setWalletAction] = useState<"credit" | "debit">("credit");
  const [walletAmount, setWalletAmount] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletConfirmationOpen, setWalletConfirmationOpen] = useState(false);
  const [walletReference, setWalletReference] = useState<string | null>(null);
  const [userActionBusy, setUserActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void searchUsers({ data: { search, status, role, page, pageSize: 20 } })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Users could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, status, role, page, refreshIndex, searchUsers]);

  useEffect(() => {
    if (!selectedUser) {
      setDetails(null);
      return;
    }
    let active = true;
    setDetailsLoading(true);
    void fetchUserDetails({ data: { userId: selectedUser.id } })
      .then((next) => {
        if (active) setDetails(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setDetails(null);
          toast.error(cause instanceof Error ? cause.message : "User details could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedUser, refreshIndex, fetchUserDetails]);

  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 20));
  const currentBalance = Number(details?.wallet?.balance ?? selectedUser?.balance ?? 0);
  const transactions = details?.transactions ?? [];
  const parsedAmount = Number(walletAmount);
  const walletAmountHasTwoDecimals =
    Number.isFinite(parsedAmount) &&
    Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) < 1e-7;
  const proposedBalance =
    walletAction === "credit" ? currentBalance + parsedAmount : currentBalance - parsedAmount;
  const requiredDeleteConfirmation = selectedUser?.email ? `DELETE ${selectedUser.email}` : "";

  async function refreshUserData() {
    setRefreshIndex((value) => value + 1);
  }

  async function confirmWalletAdjustment() {
    if (!selectedUser || !walletAmountHasTwoDecimals || parsedAmount <= 0 || !walletReason.trim()) {
      if (!walletAmountHasTwoDecimals)
        toast.error("Enter an amount with no more than two decimals.");
      return;
    }
    if (walletAction === "debit" && proposedBalance < 0) {
      toast.error("A wallet debit cannot create a negative balance.");
      return;
    }
    const reference = walletReference ?? crypto.randomUUID();
    setWalletReference(reference);
    setWalletBusy(true);
    try {
      const completed = await adjustWallet({
        data: {
          userId: selectedUser.id,
          action: walletAction,
          amount: parsedAmount,
          reason: walletReason.trim(),
          reference,
        },
      });
      toast.success(
        `${walletAction === "credit" ? "Credit" : "Debit"} recorded. New balance: ${money(completed.new_balance)}.`,
      );
      setWalletAmount("");
      setWalletReason("");
      setWalletReference(null);
      setWalletConfirmationOpen(false);
      await refreshUserData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Wallet adjustment failed.");
    } finally {
      setWalletBusy(false);
    }
  }

  async function confirmUserAction() {
    if (!pendingAction) return;
    if (pendingAction.action !== "restore" && actionReason.trim().length === 0) {
      toast.error("Enter a reason before continuing.");
      return;
    }
    if (
      pendingAction.action === "deactivate" &&
      deleteConfirmation !== `DELETE ${pendingAction.user.email ?? ""}`
    ) {
      toast.error("Type the exact confirmation phrase to deactivate this account.");
      return;
    }

    setUserActionBusy(true);
    try {
      const response = await changeUserState({
        data: {
          userId: pendingAction.user.id,
          action: pendingAction.action,
          reason: actionReason.trim(),
        },
      });
      if (response.changed) {
        toast.success(
          pendingAction.action === "restore"
            ? "Account reactivated."
            : pendingAction.action === "suspend"
              ? "Account suspended."
              : "Account deactivated. Its transaction and order history is retained.",
        );
      } else {
        toast.message("No account status change was needed.");
      }
      if (response.sessionWarning) toast.warning(response.sessionWarning);
      setPendingAction(null);
      setActionReason("");
      setDeleteConfirmation("");
      await refreshUserData();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Account status could not be changed.");
    } finally {
      setUserActionBusy(false);
    }
  }

  return (
    <section aria-labelledby="admin-users-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="admin-users-heading" className="text-2xl font-semibold">
            User Management
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Search registered accounts, inspect wallet history, and manage account access.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refreshUserData()}>
          Refresh users
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Input
          aria-label="Search users by name or email"
          placeholder="Search name or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <label className="text-sm">
          Account status
          <select
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </label>
        <label className="text-sm">
          Role
          <select
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as typeof role);
              setPage(1);
            }}
          >
            <option value="all">All roles</option>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading users…
        </p>
      ) : result?.users.length ? (
        <>
          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 font-semibold">User</th>
                  <th className="p-3 font-semibold">Role</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Wallet</th>
                  <th className="p-3 font-semibold">Registered</th>
                  <th className="p-3 font-semibold">Profile</th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="p-3">
                      <p className="font-medium">{entry.display_name || "Marketplace user"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.email ?? "No email on profile"}
                      </p>
                    </td>
                    <td className="p-3 capitalize">{entry.role}</td>
                    <td className="p-3">
                      {entry.deleted_at ? "Deactivated" : entry.suspended ? "Suspended" : "Active"}
                    </td>
                    <td className="p-3">{money(Number(entry.balance))}</td>
                    <td className="p-3">{new Date(entry.created_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedUser(entry)}
                      >
                        View details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              {result.total} user{result.total === 1 ? "" : "s"} · Page {page} of {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : (
        !error && (
          <p className="mt-6 rounded-md border border-border p-5 text-sm text-muted-foreground">
            No users match these filters.
          </p>
        )
      )}

      <Dialog
        open={Boolean(selectedUser)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUser(null);
            setDetails(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User profile</DialogTitle>
            <DialogDescription>
              Profile details and wallet ledger. Authentication secrets and passwords are never
              displayed.
            </DialogDescription>
          </DialogHeader>
          {detailsLoading ? (
            <p className="py-6 text-sm text-muted-foreground" role="status">
              Refreshing user profile…
            </p>
          ) : details ? (
            <div className="space-y-7">
              <section className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
                <p>
                  <span className="text-muted-foreground">User ID:</span>{" "}
                  <span className="break-all font-mono text-xs">{details.profile.id}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Name:</span>{" "}
                  {details.profile.display_name || "Marketplace user"}
                </p>
                <p>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  {details.profile.email || "Not available"}
                </p>
                <p>
                  <span className="text-muted-foreground">Phone:</span>{" "}
                  {details.profile.phone || "Not provided"}
                </p>
                <p>
                  <span className="text-muted-foreground">Role:</span>{" "}
                  {details.roles.includes("admin") ? "Administrator" : "User"}
                </p>
                <p>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  {details.profile.deleted_at
                    ? "Deactivated"
                    : details.profile.suspended
                      ? "Suspended"
                      : "Active"}
                </p>
                <p>
                  <span className="text-muted-foreground">Registered:</span>{" "}
                  {new Date(details.profile.created_at).toLocaleString()}
                </p>
                <p>
                  <span className="text-muted-foreground">Wallet:</span>{" "}
                  {money(Number(details.wallet?.balance ?? 0))}
                </p>
                {details.profile.suspension_reason && (
                  <p className="sm:col-span-2">
                    <span className="text-muted-foreground">Status reason:</span>{" "}
                    {details.profile.suspension_reason}
                  </p>
                )}
              </section>

              <section>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Wallet control</h3>
                  {selectedUser?.id === currentUser?.id && (
                    <p className="text-xs text-muted-foreground">
                      You cannot suspend or deactivate your own administrator account.
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded-lg border border-border p-4">
                  <p className="text-sm">
                    Current balance: <strong>{money(currentBalance)}</strong>
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="text-sm">
                      Action
                      <select
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                        value={walletAction}
                        onChange={(event) => {
                          setWalletAction(event.target.value as typeof walletAction);
                          setWalletReference(null);
                        }}
                      >
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Amount (NGN)
                      <Input
                        className="mt-1"
                        type="number"
                        min="0.01"
                        max="100000000"
                        step="0.01"
                        value={walletAmount}
                        onChange={(event) => {
                          setWalletAmount(event.target.value);
                          setWalletReference(null);
                        }}
                      />
                    </label>
                    <label className="text-sm">
                      Reason
                      <Input
                        className="mt-1"
                        maxLength={500}
                        value={walletReason}
                        onChange={(event) => {
                          setWalletReason(event.target.value);
                          setWalletReference(null);
                        }}
                        placeholder="Required ledger description"
                      />
                    </label>
                  </div>
                  <p className="mt-3 text-sm">
                    Proposed balance:{" "}
                    <strong>
                      {Number.isFinite(proposedBalance) ? money(proposedBalance) : "—"}
                    </strong>
                  </p>
                  <Button
                    type="button"
                    className="mt-4"
                    disabled={
                      walletBusy ||
                      details.profile.deleted_at !== null ||
                      !walletAmountHasTwoDecimals ||
                      parsedAmount <= 0 ||
                      proposedBalance < 0 ||
                      !walletReason.trim()
                    }
                    onClick={() => setWalletConfirmationOpen(true)}
                  >
                    Review {walletAction}
                  </Button>
                </div>
              </section>

              <section>
                <h3 className="text-lg font-semibold">Account access</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {details.profile.deleted_at ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={userActionBusy || selectedUser?.id === currentUser?.id}
                      onClick={() => setPendingAction({ action: "restore", user: selectedUser! })}
                    >
                      Reactivate account
                    </Button>
                  ) : details.profile.suspended ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={userActionBusy || selectedUser?.id === currentUser?.id}
                      onClick={() => setPendingAction({ action: "restore", user: selectedUser! })}
                    >
                      Reactivate account
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={userActionBusy || selectedUser?.id === currentUser?.id}
                        onClick={() => setPendingAction({ action: "suspend", user: selectedUser! })}
                      >
                        Suspend account
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={userActionBusy || selectedUser?.id === currentUser?.id}
                        onClick={() =>
                          setPendingAction({ action: "deactivate", user: selectedUser! })
                        }
                      >
                        Delete account
                      </Button>
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Delete deactivates the sign-in and preserves the profile, financial ledger, and
                  order history.
                </p>
              </section>

              <section>
                <h3 className="text-lg font-semibold">Wallet transaction history</h3>
                {transactions.length ? (
                  <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-border">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          <th className="p-2">Date</th>
                          <th className="p-2">Type</th>
                          <th className="p-2">Amount</th>
                          <th className="p-2">Balance after</th>
                          <th className="p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id} className="border-t border-border">
                            <td className="p-2">
                              {new Date(transaction.created_at).toLocaleString()}
                            </td>
                            <td className="p-2 capitalize">{transaction.type}</td>
                            <td className="p-2">{money(Number(transaction.amount))}</td>
                            <td className="p-2">{money(Number(transaction.balance_after))}</td>
                            <td className="p-2">{transaction.description || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No wallet transactions.</p>
                )}
                {transactions.length === 100 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the latest 100 transactions.
                  </p>
                )}
              </section>
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">User details are unavailable.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={walletConfirmationOpen}
        onOpenChange={(open) => {
          if (!walletBusy) setWalletConfirmationOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm wallet {walletAction}</DialogTitle>
            <DialogDescription>
              This will create a permanent, auditable wallet ledger entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <p>User: {selectedUser?.email}</p>
            <p>Amount: {money(parsedAmount)}</p>
            <p>Current balance: {money(currentBalance)}</p>
            <p>New balance: {money(proposedBalance)}</p>
            <p>Reason: {walletReason}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={walletBusy}
              onClick={() => setWalletConfirmationOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={walletBusy}
              onClick={() => void confirmWalletAdjustment()}
            >
              {walletBusy ? "Processing…" : `Confirm ${walletAction}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open && !userActionBusy) {
            setPendingAction(null);
            setActionReason("");
            setDeleteConfirmation("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.action === "restore"
                ? "Reactivate account?"
                : pendingAction?.action === "suspend"
                  ? "Suspend account?"
                  : "Delete / deactivate account?"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.action === "deactivate"
                ? "This soft-deactivates sign-in without deleting the profile, transactions, orders, or audit history."
                : pendingAction?.action === "suspend"
                  ? "Suspension blocks protected application functions. A reason will be recorded in the audit log."
                  : "The account will be restored if it is not otherwise restricted."}
            </DialogDescription>
          </DialogHeader>
          {pendingAction?.action !== "restore" && (
            <label className="text-sm">
              Required reason
              <Input
                className="mt-1"
                maxLength={500}
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
              />
            </label>
          )}
          {pendingAction?.action === "deactivate" && (
            <label className="text-sm">
              Type <span className="font-semibold">{requiredDeleteConfirmation}</span> to confirm.
              <Input
                className="mt-1"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={userActionBusy}
              onClick={() => setPendingAction(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={pendingAction?.action === "deactivate" ? "destructive" : "default"}
              disabled={userActionBusy}
              onClick={() => void confirmUserAction()}
            >
              {userActionBusy
                ? "Saving…"
                : pendingAction?.action === "restore"
                  ? "Reactivate"
                  : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
