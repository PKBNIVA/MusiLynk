# Subscription invoices and billing details

Every paid subscription charge gets a numbered invoice. Buyers (musicians on `/jobseeker/billing`, hirers on
`/employer/billing`) can save billing details as an individual or a business, and see, print or save each invoice as a PDF.
Booking-deposit invoices (the platform fee) are a separate, older document and are unchanged.

## What the owner must fill in: `backend/config/legal.yml`

Nothing here is invented by the code. Until these are real, invoices are **held back in production** (the charge itself is
never affected) and an amber warning shows on the admin Operations and Commerce pages. In development and test they are
issued with a visible "Seller details pending" banner. Once the fields are filled, the daily `TaxInvoiceCatchUpJob`
issues the held-back invoices in charge order.

| Field (under `business:`) | What to put | Notes |
|---|---|---|
| `legal_name` | Registered entity name | Printed as "Sold by" |
| `address` | Registered address, one line | |
| `state` | State name, e.g. `Maharashtra` | Used only if `state_code` is blank |
| `state_code` | Two-digit GST state code, e.g. `27` | Decides CGST+SGST (same state as the buyer) versus IGST. If blank it is read from the GSTIN or the state name |
| `gstin` | 15-character GSTIN | Needed only when `gst_registered: true`; it is checked for format and checksum. Leave blank until real |
| `pan` | Seller PAN | Printed on the invoice. If a GSTIN is set it should match characters 3 to 12 of it |
| `sac_code` | Services Accounting Code | Defaults to `998314` (software platform subscription); the CA confirms it |
| `gst_registered` | `true` or `false` | `false` makes every document a "Bill of supply" with no GST lines |
| `prices_include_gst` | `true` or `false` | `true` (default): plan prices already include 18% GST, so the taxable value is backed out of what was charged |
| `invoice_prefix` | Defaults to `MLK` | Numbers look like `MLK/2026-27/000123` |

`prices_include_gst: false` means the price list is before GST. Razorpay plan amounts are fixed at Razorpay, so the plan
must then be set up at the GST-added amount: the invoice always splits the amount Razorpay actually collected, so its total
equals the charge.

## How an invoice is made

- Issued from the signed `subscription.charged` webhook, once per Razorpay payment id (a retried webhook returns the same invoice).
- Numbers are sequential per financial year (April to March, in IST), drawn from the `invoice_counters` table inside the
  same transaction that inserts the invoice, so a failure leaves no gap.
- Place of supply is the buyer's state; with no billing address it is the seller's state. Seller state equals place of supply:
  CGST 9% + SGST 9%; otherwise IGST 18%. All amounts are whole paise.
- The seller block, buyer block (billing details at that moment) and line items are copied onto the invoice. Editing billing
  details later adds a new version for future invoices; issued invoices never change.
- Refunds: a processed Razorpay refund marks the invoice "Refunded" with the refund id. Credit notes are not issued.
- The invoice email goes to the account email and links to the invoice page (which needs sign-in). The billing email is
  printed on the invoice; it is not a delivery address yet.

## Admin

- Commerce tab: latest invoices, seller-details warning, and "Export invoices CSV" for a date range (IST, inclusive, up to 400
  days): number, date, buyer name, buyer type, GSTIN, state, taxable, CGST, SGST, IGST, total, document type, refund status, payment reference.
- Users tab: "Billing" shows an account's billing details (all versions) and invoices, read-only.
- Operations tab: lists the `legal.yml` fields still pending.

## No new environment variables

All of this is controlled by `config/legal.yml`; no new env vars were added.
