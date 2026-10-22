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
  adminArchiveProduct,
  adminProductActivity,
  adminSaveProduct,
  adminSearchProducts,
} from "@/lib/admin.functions";
import { splitInventoryLines } from "@/lib/admin-inventory";

type ProductResult = Awaited<ReturnType<typeof adminSearchProducts>>;
type AdminProduct = NonNullable<ProductResult["products"]>[number];
type ActivityResult = Awaited<ReturnType<typeof adminProductActivity>>;
type ProductStatus = "draft" | "published" | "unavailable";

type ProductForm = {
  id: string | null;
  title: string;
  categoryId: string;
  description: string;
  price: string;
  status: ProductStatus;
  specifications: Record<string, string>;
  deliveryInstructions: string;
  logs: string;
};

const emptyForm: ProductForm = {
  id: null,
  title: "",
  categoryId: "",
  description: "",
  price: "",
  status: "draft",
  specifications: {},
  deliveryInstructions: "",
  logs: "",
};

function productMetadata(product: AdminProduct): {
  specifications: Record<string, string>;
  deliveryInstructions: string;
} {
  const value = product.metadata;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { specifications: {}, deliveryInstructions: "" };
  }
  const rawSpecifications = value["specifications"];
  const specifications =
    typeof rawSpecifications === "object" &&
    rawSpecifications !== null &&
    !Array.isArray(rawSpecifications)
      ? Object.fromEntries(
          Object.entries(rawSpecifications).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  const instructions = value["delivery_instructions"];
  return {
    specifications,
    deliveryInstructions: typeof instructions === "string" ? instructions : "",
  };
}

const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(value);

export function AdminProducts() {
  const searchProducts = useServerFn(adminSearchProducts);
  const saveProduct = useServerFn(adminSaveProduct);
  const archiveProduct = useServerFn(adminArchiveProduct);
  const loadActivity = useServerFn(adminProductActivity);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ProductStatus | "archived">("all");
  const [categoryId, setCategoryId] = useState("all");
  const [page, setPage] = useState(1);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [result, setResult] = useState<ProductResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [formReference, setFormReference] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AdminProduct | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [activityProduct, setActivityProduct] = useState<AdminProduct | null>(null);
  const [activity, setActivity] = useState<ActivityResult>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void searchProducts({
      data: {
        search,
        status,
        categoryId: categoryId === "all" ? null : categoryId,
        page,
        pageSize: 20,
      },
    })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Products could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, status, categoryId, page, refreshIndex, searchProducts]);

  useEffect(() => {
    if (!activityProduct) return;
    let active = true;
    setActivityLoading(true);
    void loadActivity({ data: { productId: activityProduct.id } })
      .then((items) => {
        if (active) setActivity(items);
      })
      .catch((cause: unknown) => {
        if (active)
          toast.error(cause instanceof Error ? cause.message : "Activity log unavailable.");
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activityProduct, refreshIndex, loadActivity]);

  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / 20));

  function editProduct(product: AdminProduct) {
    const metadata = productMetadata(product);
    setForm({
      id: product.id,
      title: product.title,
      categoryId: product.category_id ?? "",
      description: product.description ?? "",
      price: String(product.price),
      status: product.product_status,
      specifications: metadata.specifications,
      deliveryInstructions: metadata.deliveryInstructions,
      logs: "",
    });
    setFormReference(crypto.randomUUID());
    setFormError(null);
  }

  async function submitProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const price = Number(form.price);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      Math.abs(price * 100 - Math.round(price * 100)) >= 1e-7
    ) {
      setFormError("Enter a positive NGN price with at most two decimal places.");
      return;
    }
    if (!formReference) {
      setFormError("The save request could not be prepared. Close and reopen the product form.");
      return;
    }
    const logs = splitInventoryLines(form.logs);
    if (logs.length > 1000) {
      setFormError("A product can receive at most 1000 log lines per save.");
      return;
    }
    if (logs.some((log) => log.length > 10000)) {
      setFormError("Each log line must be 10000 characters or fewer.");
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      const saved = await saveProduct({
        data: {
          reference: formReference,
          id: form.id,
          title: form.title,
          categoryId: form.categoryId || null,
          description: form.description,
          price,
          status: form.status,
          specifications: form.specifications,
          deliveryInstructions: form.deliveryInstructions,
          logs,
        },
      });
      toast.success(
        `${form.id ? "Product updated" : "Product created"}. ${saved.savedCount} ${saved.savedCount === 1 ? "log" : "logs"} saved successfully. Available stock: ${saved.stock}.`,
      );
      setForm(null);
      setFormReference(null);
      setRefreshIndex((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Product could not be saved.";
      setFormError(
        message.includes("A published product needs available delivery inventory")
          ? "A product can be published only after adding at least one available delivery record."
          : message,
      );
    } finally {
      setFormBusy(false);
    }
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    try {
      const archived = archiveTarget.archived_at === null;
      await archiveProduct({ data: { productId: archiveTarget.id, archived } });
      toast.success(
        archived
          ? "Product archived. Existing orders and inventory are preserved."
          : "Product restored.",
      );
      setArchiveTarget(null);
      setRefreshIndex((value) => value + 1);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Product status could not be changed.");
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <section aria-labelledby="admin-products-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="admin-products-heading" className="text-2xl font-semibold">
            Product Management
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage real marketplace listings, pricing, stock, and secure delivery inventory.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setForm({ ...emptyForm });
            setFormReference(crypto.randomUUID());
            setFormError(null);
          }}
        >
          Create product
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          aria-label="Search products by name"
          placeholder="Search product name"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <label className="text-sm">
          Product status
          <select
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          >
            <option value="all">All active listings</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="unavailable">Unavailable</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="text-sm">
          Product category
          <select
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All categories</option>
            {result?.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {!category.is_active || category.deleted_at ? " (inactive)" : ""}
              </option>
            ))}
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
          Loading products…
        </p>
      ) : result?.products?.length ? (
        <>
          <div className="mt-5 rounded-lg border border-border">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 font-semibold">Product</th>
                  <th className="hidden p-3 font-semibold sm:table-cell">Category</th>
                  <th className="p-3 font-semibold">Price</th>
                  <th className="p-3 font-semibold">Stock</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="hidden p-3 font-semibold md:table-cell">Created</th>
                  <th className="p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.products.map((product) => (
                  <tr key={product.id} className="border-t border-border">
                    <td className="break-words p-3">
                      <p className="font-medium">{product.title}</p>
                      <p className="mt-1 hidden break-all text-xs text-muted-foreground sm:block">
                        {product.slug}
                      </p>
                    </td>
                    <td className="hidden break-words p-3 sm:table-cell">
                      {product.product_categories?.name ?? "Uncategorized"}
                    </td>
                    <td className="p-3">{money(Number(product.price))}</td>
                    <td className="p-3">{product.stock}</td>
                    <td className="p-3 capitalize">
                      {product.archived_at ? "Archived" : product.product_status}
                    </td>
                    <td className="hidden p-3 md:table-cell">
                      {new Date(product.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {!product.archived_at && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => editProduct(product)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => editProduct(product)}
                            >
                              Add inventory
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setActivityProduct(product)}
                        >
                          Activity
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={product.archived_at ? "outline" : "destructive"}
                          onClick={() => setArchiveTarget(product)}
                        >
                          {product.archived_at ? "Restore" : "Archive"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              {result.total} product{result.total === 1 ? "" : "s"} · Page {page} of {pageCount}
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
          <div className="mt-6 rounded-md border border-border p-5 text-sm text-muted-foreground">
            No products match these filters.
          </div>
        )
      )}

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open && !formBusy) setForm(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit product" : "Create product"}</DialogTitle>
            <DialogDescription>
              Product details are saved to the marketplace database.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form className="space-y-4" onSubmit={(event) => void submitProduct(event)}>
              <label className="block text-sm">
                Product name
                <Input
                  className="mt-1"
                  required
                  maxLength={160}
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  Category
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                    value={form.categoryId}
                    onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                  >
                    <option value="">Uncategorized</option>
                    {result?.categories
                      .filter(
                        (category) =>
                          (category.is_active && !category.deleted_at) ||
                          category.id === form.categoryId,
                      )
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                          {!category.is_active || category.deleted_at ? " (inactive)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Status
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                    value={form.status}
                    onChange={(event) =>
                      setForm({ ...form, status: event.target.value as ProductStatus })
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </label>
              </div>
              <label className="block text-sm">
                Description
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3"
                  maxLength={10000}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  Price (NGN)
                  <Input
                    className="mt-1"
                    type="number"
                    min="0.01"
                    max="100000000"
                    step="0.01"
                    required
                    value={form.price}
                    onChange={(event) => setForm({ ...form, price: event.target.value })}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Add logs, 1 log per line
                <textarea
                  className="mt-1 min-h-36 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
                  value={form.logs}
                  onChange={(event) => setForm({ ...form, logs: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block text-sm">
                Delivery instructions
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-3"
                  maxLength={5000}
                  value={form.deliveryInstructions}
                  onChange={(event) =>
                    setForm({ ...form, deliveryInstructions: event.target.value })
                  }
                />
              </label>
              {formError && (
                <p className="rounded-md border border-destructive p-3 text-sm" role="alert">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={formBusy}
                  onClick={() => setForm(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={formBusy}>
                  {formBusy ? "Saving…" : "Save product"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) setArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {archiveTarget?.archived_at ? "Restore product?" : "Archive product?"}
            </DialogTitle>
            <DialogDescription>
              {archiveTarget?.archived_at
                ? "Restoring makes this product visible according to its saved publication status."
                : "This removes the product from browsing and checkout while preserving the product, delivery inventory, orders, and transaction history."}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border p-3 text-sm">{archiveTarget?.title}</p>
          {!archiveTarget?.archived_at && (
            <p className="text-sm text-muted-foreground">
              Existing linked orders: {archiveTarget?.order_count ?? 0}. Order details and delivered
              records are retained.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={archiveBusy}
              onClick={() => setArchiveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={archiveTarget?.archived_at ? "default" : "destructive"}
              disabled={archiveBusy}
              onClick={() => void confirmArchive()}
            >
              {archiveBusy ? "Saving…" : archiveTarget?.archived_at ? "Restore" : "Archive product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(activityProduct)}
        onOpenChange={(open) => {
          if (!open) setActivityProduct(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Product Activity Log</DialogTitle>
            <DialogDescription>
              {activityProduct?.title} · Administrative changes only; delivery record contents are
              never logged.
            </DialogDescription>
          </DialogHeader>
          {activityLoading ? (
            <p className="py-5 text-sm text-muted-foreground" role="status">
              Loading activity…
            </p>
          ) : activity.length ? (
            <ol className="space-y-3">
              {activity.map((entry) => (
                <li key={entry.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <strong>
                      {entry.action.replace("admin.product.", "").replaceAll("_", " ")}
                    </strong>
                    <time className="text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Administrator: {entry.actor_id ?? "Unavailable"}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-5 text-sm text-muted-foreground">
              No product activity has been recorded.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
