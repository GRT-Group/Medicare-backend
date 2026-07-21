# Quotation Frontend Implementation Guide

This document outlines the frontend implementation strategy for the **Quotations** module. It maps the requested UI features to the corresponding API endpoints and establishes guidelines for building a professional, conversion-focused proposal management interface.

---

## 1. Module Overview

The Quotation module is divided into two primary views:
1. **Quotation Control Center (List/Pipeline View)**
2. **New/Edit Quotation Form (Builder View)**

### Core Objectives
- **Proposal Operations Center:** Manage quotations, proforma offers, proposal value, validity control, approval status, customer follow-up, and offline sales preparation.
- **Quotation Workflow Controls:**
  - **Validity Control:** Protect current pricing and prevent outdated offers from being accepted.
  - **Conversion Tracking:** Mark accepted proposals to measure sales performance and customer intent.
  - **Offline Continuity:** Prepare, edit, and accept quotations locally until the branch reconnects.

---

## 2. Quotation Control Center (List View)

### 2.1 KPI Dashboard (Statistics)
**API Endpoint:** `GET /api/quotations/stats`

The top of the Quotations page should display a dynamic KPI pipeline overview:
- **Accepted Value:** `RF {accepted_value}`
- **Conversion:** `{conversion_rate}%` (accepted ratio)
- **Filtered Results / All Quotes:** `{total}` pipeline records
- **Accepted:** `{by_status.accepted}` ready for sale
- **Open (Draft/Sent):** `{pipeline_count}` needs follow-up
- **Total Value:** `RF {total_value}` proposal value
- **Expired:** `{by_status.expired}` price risk
- **Pipeline Value:** `RF {pipeline_value}`

### 2.2 List Filters and Search
- **Search Bar:** "Search quotation, customer, phone, email, notes, or item..."
- **Filters:** 
  - Status Dropdown (`All Status`, `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CONVERTED`)
  - Sync Status (`All Sync`, `Synced`, `Pending`)
- **Actions:** 
  - `Reset` filters
  - `Export` (CSV/Excel)
  - `New Quotation` (Primary Button)

### 2.3 Quotation Cards / Table View
**API Endpoint:** `GET /api/quotations`

For each quotation in the list, display a summary card or table row containing:
- **Quotation Number & Date:** `QT-58193032` | `15 Jun 2026, 23:16`
- **Status Badge:** e.g., <span style="color:red">expired</span>, <span style="color:orange">open</span>, <span style="color:green">accepted</span>
- **Customer Info:** Name, Email (`madibajado@gmail.com`), Phone (`0786485989`)
- **Offer Details:** 
  - Items Count (`Items: 1`)
  - Validity Date (`Valid: 15 Jun 2026`)
  - Total Value (`Total: RF 2,900`)
- **Action:** `View` (Button to open details/edit modal)

---

## 3. New / Edit Quotation (Builder View)

**API Endpoint:** `POST /api/quotations` (Create) | `PUT /api/quotations/:id` (Update)

The quotation builder should feel like a professional POS/Cart interface mixed with CRM capabilities.

### 3.1 Customer & Header Details
- **Customer Name (*):** Required text input or searchable dropdown (linked to Customer API).
- **Customer Email:** Email input for sending the quotation directly.
- **Customer Phone:** Phone number input.
- **Validity Date:** Date picker (`mm/dd/yyyy`). Essential for "Validity Control".

### 3.2 Quotation Items (The Cart)
- **Add Product:** Searchable product dropdown/modal to add items to the quotation.
- **Empty State:** "No products selected. Choose products above to build a priced customer proposal."
- **Item Rows:** For each added product, allow editing of:
  - Quantity
  - Unit Price (default to product base price, but editable)
  - Tax Rate
  - Line Discount
- **Real-time Calculations:**
  - Update line subtotals dynamically on the frontend before saving.

### 3.3 Summary & Totals
- **Subtotal:** `RF {calculated_subtotal}`
- **Tax (e.g., 16%):** `RF {calculated_tax}`
- **Header Discount:** `- RF {entered_discount}`
- **Total:** `RF {calculated_total}`
- **Actions:** `Save Draft`, `Save & Send Email`.

---

## 4. Quotation Actions & Workflow

Once a quotation is created, the "View" page should expose the following workflow controls based on its status. Here are the expected request bodies for each action.

### 4.1 Send/Email Quotation
- **API Endpoint:** `POST /api/quotations/:id/send`
- **Condition:** Status is `DRAFT` or `SENT`
- **Description:** Sends a professional HTML email to the customer's email address and updates status to `SENT`.
- **Request Body:** None required.
```json
{}
```

### 4.2 Mark Accepted / Rejected
- **API Endpoint:** `PUT /api/quotations/:id/status`
- **Condition:** Status is `SENT` or `DRAFT`
- **Description:** Updates status to `ACCEPTED` or `REJECTED`. Crucial for conversion tracking.
- **Request Body:**
```json
{
  "status": "ACCEPTED" // or "REJECTED"
}
```

### 4.3 Convert to Sale
- **API Endpoint:** `POST /api/quotations/:id/convert`
- **Condition:** Status is `ACCEPTED`
- **Description:** Prompts for payment method and converts the proposal into an actual transaction, deducting stock. Updates status to `CONVERTED`.
- **Request Body:**
```json
{
  "payment_method": "CASH", // or MOBILE_MONEY, BANK_TRANSFER, CREDIT
  "amount_paid": 3364
}
```

### 4.4 Duplicate Quotation
- **API Endpoint:** `POST /api/quotations/:id/duplicate`
- **Condition:** Any status
- **Description:** Clones the quotation (helpful for re-quoting expired offers or duplicating winning quotes for similar clients).
- **Request Body:** None required.
```json
{}
```

---

## 5. UI/UX Professionalism Guidelines

To ensure the interface meets the "professional" requirement:
1. **Empty States:** Use branded illustrations and clear instructions (e.g., "Choose products above to build a priced customer proposal.").
2. **Typography:** Use a clean, modern sans-serif font (e.g., Inter, Roboto) for financial figures.
3. **Status Colors:** 
   - `DRAFT`: Gray
   - `SENT`: Blue
   - `ACCEPTED`: Green
   - `REJECTED`: Red
   - `EXPIRED`: Orange
   - `CONVERTED`: Purple / Indigo
4. **Micro-interactions:** Show loading spinners when adding products or calculating totals. Use toast notifications for success/error states (e.g., "Quotation Sent Successfully!").
5. **Responsiveness:** Ensure the item table scrolls horizontally on smaller screens, or collapses into a card-based layout.
6. **Form Validation:** Highlight missing required fields (like Customer Name and Validity Date) in red before allowing submission.
