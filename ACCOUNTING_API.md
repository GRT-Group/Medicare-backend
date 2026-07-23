# Financial Accounting API Documentation

This document outlines the API endpoints available for the Financial Accounting module, specifically for generating Profit & Loss, Cash Flow, and Balance Sheet statements.

## 1. Profit & Loss Statement

Retrieves the aggregated data for the income statement, calculating revenue, cost of goods sold, gross profit, operating expenses, and net profit for a given date range.

- **Method:** `GET`
- **Endpoint:** `/api/accounting/profit-loss`
- **Authentication:** Required (Bearer Token)
- **Request Body:** None
- **Organization Scope:** Automatically scoped to the authenticated user's `organization_id`.

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `startDate` | ISO Date String | No | The start date for the reporting period. Defaults to the first day of the current year. |
| `endDate` | ISO Date String | No | The end date for the reporting period. Defaults to the current date and time. |
| `branch_id` | String / Number | No | Filter the statement for a specific branch. If omitted, aggregates across all branches. |

### Request Example

```bash
curl -X GET "https://api.yourdomain.com/api/accounting/profit-loss?startDate=2024-01-01T00:00:00Z" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "revenue": 50000.00,
    "cogs": 20000.00,
    "grossProfit": 30000.00,
    "operatingExpenses": 8000.00,
    "netProfit": 22000.00,
    "breakdown": {
      "salesRevenue": 50000.00,
      "costOfGoodsSold": 20000.00,
      "cashbookExpenses": 3000.00,
      "payrollExpenses": 5000.00
    }
  }
}
```

---

## 2. Cash Flow Statement

Retrieves the actual cash movements (liquidity) in and out of the business, excluding unpaid credit sales and including capital injections or supplier payouts.

- **Method:** `GET`
- **Endpoint:** `/api/accounting/cash-flow`
- **Authentication:** Required (Bearer Token)
- **Request Body:** None
- **Organization Scope:** Automatically scoped to the authenticated user's `organization_id`.

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `startDate` | ISO Date String | No | The start date for the reporting period. Defaults to the first day of the current year. |
| `endDate` | ISO Date String | No | The end date for the reporting period. Defaults to the current date and time. |
| `branch_id` | String / Number | No | Filter the statement for a specific branch. If omitted, aggregates across all branches. |

### Request Example

```bash
curl -X GET "https://api.yourdomain.com/api/accounting/cash-flow?startDate=2024-01-01T00:00:00Z" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "inflows": {
      "sales": 45000.00,
      "customerPayments": 2000.00,
      "otherIn": 1000.00,
      "total": 48000.00
    },
    "outflows": {
      "supplierPayments": 15000.00,
      "expenses": 3000.00,
      "payroll": 5000.00,
      "total": 23000.00
    },
    "netCashFlow": 25000.00
  }
}
```

---

## 3. Balance Sheet

Retrieves a snapshot of the business's financial position at a specific point in time, detailing Assets, Liabilities, and Equity.

- **Method:** `GET`
- **Endpoint:** `/api/accounting/balance-sheet`
- **Authentication:** Required (Bearer Token)
- **Request Body:** None
- **Organization Scope:** Automatically scoped to the authenticated user's `organization_id`.

### Query Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `asOfDate` | ISO Date String | No | The date to generate the snapshot for. Defaults to the current date and time. |
| `branch_id` | String / Number | No | Filter the statement for a specific branch. If omitted, aggregates across all branches. |

### Request Example

```bash
curl -X GET "https://api.yourdomain.com/api/accounting/balance-sheet?asOfDate=2024-12-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "asOfDate": "2024-12-31T23:59:59.999Z",
    "assets": {
      "cashAndEquivalents": 25000.00,
      "accountsReceivable": 5000.00,
      "inventoryValue": 15000.00,
      "total": 45000.00
    },
    "liabilities": {
      "accountsPayable": 10000.00,
      "total": 10000.00
    },
    "equity": {
      "retainedEarnings": 35000.00,
      "total": 35000.00
    }
  }
}
```

### Notes for Frontend Developers
- All three APIs require the user to be authenticated via a standard Bearer Token (`Authorization: Bearer <token>`) or the `medicare_token` cookie. They will return a `401 Unauthorized` if no valid token is found.
- All monetary values are returned as numbers and should be formatted using your standard currency formatter (e.g., `formatCurrency` from `@/i18n/formatters`).
- When date parameters are omitted, P&L and Cash Flow default to "Year to Date", while Balance Sheet defaults to "Today".
- The calculated values can be negative, indicating a loss or a negative cash flow period. Ensure the UI handles negative values gracefully.
- **Graceful Degradation:** The backend APIs are fully indestructible. If certain modules are not yet used by the organization (such as Payroll, Customer Payments, or Supplier Tracking), the API will safely ignore them and default those values to `0` rather than throwing errors.
