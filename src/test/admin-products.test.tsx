import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProducts } from "@/components/admin-products";

const product = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Starter account",
  slug: "starter-account",
  category_id: null,
  description: null,
  price: 2500,
  currency: "NGN",
  stock: 10,
  published: false,
  product_status: "draft" as const,
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  archived_at: null,
  product_categories: null,
  order_count: 0,
};

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  save: vi.fn(),
  archive: vi.fn(),
  activity: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (serverFn: unknown) => serverFn }));
vi.mock("@/lib/admin.functions", () => ({
  adminArchiveProduct: mocks.archive,
  adminProductActivity: mocks.activity,
  adminSaveProduct: mocks.save,
  adminSearchProducts: mocks.search,
}));

function result(products: (typeof product)[] = []) {
  return { products, categories: [], total: products.length, page: 1, pageSize: 20 };
}

describe("admin product logs", () => {
  beforeEach(() => {
    mocks.search.mockReset().mockResolvedValue(result([product]));
    mocks.save.mockReset().mockResolvedValue({ id: product.id, stock: 0, savedCount: 0 });
    mocks.archive.mockReset();
    mocks.activity.mockReset();
  });

  it("removes the old inventory controls and retains product fields", async () => {
    render(<AdminProducts />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByLabelText("Product image URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sellable stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Delivery Inventory / Product Logs")).not.toBeInTheDocument();
    expect(screen.queryByText("Bulk Add Logs")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Another Log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview records" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add logs, 1 log per line")).toBeInTheDocument();
    expect(screen.getByLabelText("Delivery instructions")).toBeInTheDocument();
  });

  it("creates one inventory record per nonblank line and preserves its full text", async () => {
    mocks.save.mockResolvedValueOnce({ id: product.id, stock: 3, savedCount: 3 });
    render(<AdminProducts />);
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Plain log product" },
    });
    fireEvent.change(screen.getByLabelText("Price (NGN)"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Add logs, 1 log per line"), {
      target: {
        value:
          "  ID: 22334455 | Password: 123456  \n\nusername123:password789\n Facebook USA account - ID 123456 ",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].data).toMatchObject({
      id: null,
      logs: [
        "ID: 22334455 | Password: 123456",
        "username123:password789",
        "Facebook USA account - ID 123456",
      ],
    });
  });

  it("appends only new lines when editing an existing product", async () => {
    mocks.save.mockResolvedValueOnce({ id: product.id, stock: 13, savedCount: 3 });
    render(<AdminProducts />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Add logs, 1 log per line"), {
      target: { value: "newlog11\n\n newlog12 \nnewlog13" },
    });
    fireEvent.change(screen.getByLabelText("Delivery instructions"), {
      target: { value: "Sign in before use." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].data).toMatchObject({
      id: product.id,
      logs: ["newlog11", "newlog12", "newlog13"],
      deliveryInstructions: "Sign in before use.",
    });
  });

  it("accepts any nonblank log and ignores whitespace-only lines", async () => {
    render(<AdminProducts />);
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Plain text" } });
    fireEvent.change(screen.getByLabelText("Price (NGN)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Add logs, 1 log per line"), {
      target: { value: "hello\n \t \nlog two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].data.logs).toEqual(["hello", "log two"]);
  });
});
