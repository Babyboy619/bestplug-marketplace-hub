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
  adminSaveCategory,
  adminSearchCategories,
  adminSetCategoryState,
} from "@/lib/admin.functions";

type CategoryRows = Awaited<ReturnType<typeof adminSearchCategories>>;
type Category = CategoryRows[number];
type CategoryForm = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  displayOrder: string;
};
const emptyForm: CategoryForm = {
  id: null,
  name: "",
  slug: "",
  description: "",
  imageUrl: "",
  displayOrder: "0",
};
const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function AdminCategories() {
  const searchCategories = useServerFn(adminSearchCategories);
  const saveCategory = useServerFn(adminSaveCategory);
  const changeState = useServerFn(adminSetCategoryState);
  const [categories, setCategories] = useState<CategoryRows>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<CategoryForm | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stateTarget, setStateTarget] = useState<{
    category: Category;
    action: "activate" | "deactivate" | "delete" | "restore";
  } | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void searchCategories({})
      .then((result) => {
        if (active) setCategories(result);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Categories could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [searchCategories, refresh]);

  function edit(category?: Category) {
    setSlugTouched(Boolean(category));
    setForm(
      category
        ? {
            id: category.id,
            name: category.name,
            slug: category.slug,
            description: category.description ?? "",
            imageUrl: category.image_url ?? "",
            displayOrder: String(category.display_order),
          }
        : { ...emptyForm },
    );
    setFormError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (form.imageUrl) {
      try {
        const url = new URL(form.imageUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      } catch {
        setFormError("Category images must use a valid HTTP or HTTPS URL.");
        return;
      }
    }
    const displayOrder = Number(form.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 100000) {
      setFormError("Display order must be a whole number from 0 to 100000.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await saveCategory({
        data: {
          id: form.id,
          name: form.name,
          slug: form.slug,
          description: form.description,
          imageUrl: form.imageUrl,
          displayOrder,
        },
      });
      toast.success(form.id ? "Category updated." : "Category created.");
      setForm(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Category could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmStateChange() {
    if (!stateTarget) return;
    const { category, action } = stateTarget;
    if (action === "delete" && Number(category.product_count) > 0 && !reassignTo) {
      toast.error("Choose an active category to receive this category's products.");
      return;
    }
    setBusy(true);
    try {
      const result = await changeState({
        data: {
          categoryId: category.id,
          action,
          reassignTo: action === "delete" && reassignTo ? reassignTo : null,
        },
      });
      const message =
        action === "delete"
          ? `Category archived. ${result.reassigned_products} linked products reassigned; records preserved.`
          : action === "restore"
            ? "Category restored as inactive."
            : action === "activate"
              ? "Category activated."
              : "Category deactivated.";
      toast.success(message);
      setStateTarget(null);
      setReassignTo("");
      setRefresh((value) => value + 1);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Category could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const activeDestinations = categories.filter(
    (category) =>
      category.is_active && !category.deleted_at && category.id !== stateTarget?.category.id,
  );

  return (
    <section aria-labelledby="admin-categories-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="admin-categories-heading" className="text-2xl font-semibold">
            Category Management
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage live marketplace categories and safely reassign products before archiving.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>
            Refresh
          </Button>
          <Button type="button" onClick={() => edit()}>
            Create category
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive p-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading categories…
        </p>
      ) : categories.length ? (
        <div className="mt-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3">Category</th>
                <th className="p-3">Slug</th>
                <th className="p-3">Order</th>
                <th className="p-3">Products</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-t border-border">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {category.image_url ? (
                        <img
                          src={category.image_url}
                          alt=""
                          className="size-9 rounded object-cover"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded bg-muted font-semibold">
                          {category.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <p className="font-medium">{category.name}</p>
                        {category.description && (
                          <p className="max-w-xs truncate text-xs text-muted-foreground">
                            {category.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-xs">{category.slug}</td>
                  <td className="p-3">{category.display_order}</td>
                  <td className="p-3">{category.product_count}</td>
                  <td className="p-3">
                    {category.deleted_at ? "Deleted" : category.is_active ? "Active" : "Inactive"}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {!category.deleted_at && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => edit(category)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setStateTarget({
                                category,
                                action: category.is_active ? "deactivate" : "activate",
                              })
                            }
                          >
                            {category.is_active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setStateTarget({ category, action: "delete" })}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                      {category.deleted_at && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setStateTarget({ category, action: "restore" })}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && (
          <p className="mt-6 rounded-md border border-border p-5 text-sm text-muted-foreground">
            No categories yet. Create one to make it available in the marketplace.
          </p>
        )
      )}

      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && !busy && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit category" : "Create category"}</DialogTitle>
            <DialogDescription>
              Slugs are used in marketplace filters. Duplicate names and slugs are rejected by the
              database.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form className="space-y-4" onSubmit={(event) => void submit(event)}>
              <label className="block text-sm">
                Name
                <Input
                  className="mt-1"
                  value={form.name}
                  required
                  maxLength={100}
                  onChange={(event) => {
                    const name = event.target.value;
                    setForm({
                      ...form,
                      name,
                      slug: slugTouched ? form.slug : slugify(name),
                    });
                  }}
                />
              </label>
              <label className="block text-sm">
                URL slug
                <Input
                  className="mt-1"
                  value={form.slug}
                  required
                  maxLength={120}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={(event) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: slugify(event.target.value) });
                  }}
                />
              </label>
              <label className="block text-sm">
                Description (optional)
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-3"
                  maxLength={1000}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                Image or icon URL (optional)
                <Input
                  className="mt-1"
                  type="url"
                  maxLength={2048}
                  value={form.imageUrl}
                  onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                Display order
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={form.displayOrder}
                  onChange={(event) => setForm({ ...form, displayOrder: event.target.value })}
                />
              </label>
              {formError && (
                <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save category"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(stateTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setStateTarget(null);
            setReassignTo("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {stateTarget?.action === "delete"
                ? "Delete category?"
                : stateTarget?.action === "restore"
                  ? "Restore category?"
                  : `${stateTarget?.action === "activate" ? "Activate" : "Deactivate"} category?`}
            </DialogTitle>
            <DialogDescription>
              Deleting archives the category record instead of removing it. Existing orders and
              product records are retained.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border p-3 text-sm">
            {stateTarget?.category.name} · {stateTarget?.category.product_count ?? 0} linked
            products
          </p>
          {stateTarget?.action === "delete" && Number(stateTarget.category.product_count) > 0 && (
            <label className="text-sm">
              Reassign linked products to
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                value={reassignTo}
                onChange={(event) => setReassignTo(event.target.value)}
                required
              >
                <option value="">Select active category</option>
                {activeDestinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
              {!activeDestinations.length && (
                <span className="mt-1 block text-xs text-destructive">
                  Create or activate another category before deleting this one.
                </span>
              )}
            </label>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setStateTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={stateTarget?.action === "delete" ? "destructive" : "default"}
              disabled={
                busy ||
                (stateTarget?.action === "delete" &&
                  Number(stateTarget.category.product_count) > 0 &&
                  !reassignTo)
              }
              onClick={() => void confirmStateChange()}
            >
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
