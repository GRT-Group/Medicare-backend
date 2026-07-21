import { NextResponse } from 'next/server';
import { friendlyMessage } from '@/lib/api-error'
import { InventoryService } from '@/services/inventory.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export async function GET(req: Request) {
  try {
    const orgId = req.headers.get('x-organization-id');
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    if (!orgId) return NextResponse.json({ error: 'Missing x-organization-id header' }, { status: 400 });

    const movements = await InventoryService.getInventoryMovements(BigInt(orgId), productId ? BigInt(productId) : undefined);
    
    // Formatting to match the expected structure
    const formatted = movements.map((m: any) => {
      let typeLabel = m.type.toLowerCase().replace('_', ' ');
      if (m.type === 'SALE') typeLabel = 'sale';

      let qty = m.quantity;
      if (m.movement_type_id?.includes('DOWN') || m.movement_type_id?.includes('OUT') || m.movement_type_id === 'DECREASE' || m.movement_type_id === 'DISPOSAL') {
        qty = -m.quantity;
      }

      return {
        id: m.id,
        productName: m.Product?.name || 'Unknown Product',
        type: typeLabel,
        risk: m.risk_level || 'Normal',
        date: m.timestamp,
        quantityChange: qty > 0 ? `+${qty}` : qty.toString(),
        stockState: m.stock_before !== null && m.stock_after !== null ? `${m.stock_before} -> ${m.stock_after}` : 'N/A',
        reference: m.reference_id || 'None',
        productId: m.product_id,
        notes: `${m.notes ? m.notes + ' \u00B7 ' : ''}Batch ${m.ProductBatch?.batch_number || 'Unknown'}`
      };
    });

    return NextResponse.json(formatted, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyMessage(error) }, { status: 500 });
  }
}
