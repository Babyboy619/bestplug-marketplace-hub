export type ProductPurchaseResult = {
  ok: true;
  orderId: string;
  orderReference: string;
  orderItemId: string;
  title: string;
  platform: string;
  unitPrice: number;
  createdAt: string;
  paymentStatus: string;
  deliveryStatus: string;
  deliveredPayload: string;
  specifications: Record<string, string>;
  deliveryInstructions: string;
  availableStock: number;
};
