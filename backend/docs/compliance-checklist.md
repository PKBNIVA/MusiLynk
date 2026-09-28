# Compliance checklist (India launch)

Everything below is groundwork for a lawyer/CA to review before launch — none of it is legal or
tax advice, and the pages themselves say so. This checklist exists so the review has a clear,
short list of what to confirm and which config fields the business owner fills in (no code
changes needed for any of it).

## config/legal.yml — fields the owner fills in

| Field | What it is | Where it shows up |
|---|---|---|
| `business.legal_name` | The registered entity name (e.g. "Alien Brains Private Limited") | Privacy footer, printed invoices |
| `business.gstin` | The GST Identification Number, once registered. **Leave blank until real** — `LegalConfig.gstin_present?` gates GST display on invoices; nothing here is ever fabricated. | Printed invoices |
| `business.address` | Registered business address | Printed invoices, Privacy DPDP section |
| `business.state` | State of the registered address (place of supply for GST) | Printed invoices |
| `grievance_officer.name` | DPDP Act, 2023 Grievance Officer's name | Privacy Policy page |
| `grievance_officer.email` | Grievance Officer's contact email | Privacy Policy page |
| `grievance_officer.address` | Grievance Officer's contact address | Privacy Policy page |

## config/bookings.yml — fields the owner fills in

| Field | What it is | Default |
|---|---|---|
| `platform_fee_percent` | Verse's commission on a booking, as a percent of the quote total | `0` (off) |
| `fee_paid_by` | `"hirer"` (fee added to the hirer's deposit) or `"split"` (half the fee is tracked against the musician's future payout — see "TDS on payouts" below; Verse has no payout system yet, so that half is never actually collected today) | `"hirer"` |
| `min_fee_inr` | A floor under the computed fee | `0` |
| `gst_percent` | GST rate applied to the fee only (never to the artist's performance fee) | `18` |
| `cancellation.full_refund_days` / `partial_refund_days` / `partial_refund_percent` | The cancellation windows shown on Terms and enforced by `BookingFeePolicy` | `7` / `2` / `50` |

Changing any of these only affects quotes/payments created **after** the change — every existing
quote, payment and invoice keeps the `policy_version`/fee snapshot that was in force when it was
created (additive columns, never rewritten).

## To confirm with a CA/lawyer before launch

1. **GST registration threshold and place of supply.** Once `platform_fee_percent` is turned on,
   Verse is charging a fee for a service (booking facilitation) — confirm the GST registration
   threshold applies (or already applies from other revenue, e.g. subscriptions), and that
   `business.state` correctly reflects the place of supply used on invoices.
2. **TDS on payouts, if Verse ever pays musicians directly.** Today Verse only collects a deposit
   from the hirer; it does not disburse anything to musicians. If a payout system is built later
   (relevant to `fee_paid_by: "split"`, where half the fee is meant to come out of the musician's
   payout), confirm TDS (Section 194-something, depending on the arrangement) and the payout
   reporting obligations before it goes live.
3. **DPDP Act, 2023 consent and Grievance Officer.** Confirm the consent language on the Privacy
   Policy's DPDP section is adequate for the data actually collected, that the "withdraw consent" /
   account-deletion path meets the Act's requirements, and that `grievance_officer.*` names a real,
   reachable person before launch (the page currently shows literal `[NAME]`/`[EMAIL]`/`[ADDRESS]`
   placeholders until that config is filled in).
4. **Invoice format.** Confirm the printed invoice (`src/app/pages/InvoicePrint.tsx`,
   `InvoicesController#show`) has every field an Indian GST invoice requires (a CA should check the
   line items, the FY-based invoice numbering scheme "V/FY/000001", and whether an HSN/SAC code or
   additional declarations are needed for a booking-facilitation fee specifically).
5. **Refund/cancellation policy vs. consumer protection.** Confirm the cancellation windows and the
   no-show rules (musician no-show → full refund + fee waived; hirer no-show → deposit kept) hold
   up under Indian consumer protection rules for a marketplace booking, and that the plain-English
   text on the Terms page (generated live from `config/bookings.yml` — see `BookingFeePolicy#plain_english`)
   says what the lawyer wants it to say before it's treated as the final wording.

## What is deliberately NOT done yet

- No refund is ever sent automatically. A cancellation or no-show only *records* the intended
  refund (`RefundRecord`, status `pending_manual`) for an admin to action manually in the Razorpay
  dashboard; this codebase has no code path that calls Razorpay's refund API. See
  `app/models/refund_record.rb` and the "Refunds to review" list in the admin Commerce tab.
- No GSTIN is fabricated. `config/legal.yml`'s `business.gstin` ships blank; until it's filled in,
  invoices print `—` where the GSTIN would go.
