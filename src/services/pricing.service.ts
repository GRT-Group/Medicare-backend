export interface PricingItem {
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_discount: number;
  tax_rate?: number; // e.g. 0.18 for 18% VAT
}

export interface PricingResult {
  subtotal: number;
  tax_total: number;
  discount_total: number;
  profit_total: number;
  margin_percent: number;
  grand_total: number;
  items: Array<{
    subtotal: number;
    line_tax: number;
    line_profit: number;
  }>;
}

export class PricingEngine {
  /**
   * Pure function to calculate all POS totals.
   * Never trust client totals; always recompute them on the server.
   */
  static recalculateTotals(items: PricingItem[]): PricingResult {
    let subtotal = 0;
    let tax_total = 0;
    let discount_total = 0;
    let profit_total = 0;
    
    const computedItems = items.map(item => {
      const grossSubtotal = item.quantity * item.unit_price;
      const lineSubtotal = grossSubtotal - item.line_discount;
      
      const lineTax = lineSubtotal * (item.tax_rate || 0);
      const lineCost = item.quantity * item.unit_cost;
      const lineProfit = lineSubtotal - lineCost;

      subtotal += lineSubtotal;
      tax_total += lineTax;
      discount_total += item.line_discount;
      profit_total += lineProfit;

      return {
        subtotal: lineSubtotal,
        line_tax: lineTax,
        line_profit: lineProfit
      };
    });

    const grand_total = subtotal + tax_total;
    const margin_percent = subtotal > 0 ? (profit_total / subtotal) * 100 : 0;

    return {
      subtotal,
      tax_total,
      discount_total,
      profit_total,
      margin_percent,
      grand_total,
      items: computedItems
    };
  }
}
