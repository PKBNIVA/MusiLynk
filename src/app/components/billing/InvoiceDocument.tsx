import { formatDate } from '../../lib/format';
import { DOCUMENT_TITLE, formatPaise, type InvoiceDocumentData, type InvoiceParty } from '../../lib/billingProfile';

const addressLines = (party: InvoiceParty) =>
  [
    party.address,
    party.addressLine1,
    party.addressLine2,
    [party.city, party.postalCode].filter(Boolean).join(' '),
    party.state ? `${party.state}${party.stateCode ? ` (${party.stateCode})` : ''}` : '',
  ].filter((line): line is string => Boolean(line && line.trim()));

function Party({ title, party, testId }: { title: string; party: InvoiceParty; testId: string }) {
  const name = party.legalName || party.name;
  return (
    <section className="min-w-0 text-sm text-slate-800" data-testid={testId}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <p className="mt-1 text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{name || '—'}</p>
      {addressLines(party).map((line) => (
        <p key={line} className="[overflow-wrap:anywhere]">
          {line}
        </p>
      ))}
      {party.gstin && <p className="mt-1 font-mono text-xs">GSTIN: {party.gstin}</p>}
      {party.pan && <p className="font-mono text-xs">PAN: {party.pan}</p>}
      {party.email && title === 'Billed to' && <p className="[overflow-wrap:anywhere]">{party.email}</p>}
      {party.poReference && <p className="text-xs">PO / reference: {party.poReference}</p>}
    </section>
  );
}

/**
 * A GST tax invoice or bill of supply on white paper. Light theme always (it is printed), laid out
 * to fit A4 and a phone screen without sideways scrolling. Every figure comes from the invoice
 * snapshot the API stores; nothing is recalculated here.
 */
export function InvoiceDocument({
  invoice,
  showPendingBanner,
}: {
  invoice: InvoiceDocumentData;
  showPendingBanner?: boolean;
}) {
  const tax = invoice.documentType === 'tax_invoice';
  const intra = tax && invoice.cgstPaise + invoice.sgstPaise > 0;
  const half = invoice.ratePercent / 2;
  const refund = invoice.refund;
  return (
    <article
      className="invoice-document text-slate-900"
      data-testid="invoice-document"
      data-document-type={invoice.documentType}
    >
      {(showPendingBanner || invoice.sellerPendingBanner) && (
        <div
          role="note"
          data-testid="seller-pending-banner"
          className="mb-4 rounded border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:border-slate-500"
        >
          <b>Seller details pending.</b> The business name, address, state or tax numbers in config/legal.yml are not
          filled in yet, so this is a test document and not valid for tax purposes.
        </div>
      )}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b-2 border-slate-900 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="invoice-title">
            {DOCUMENT_TITLE[invoice.documentType]}
          </h1>
          <p className="text-xs text-slate-500">Original for recipient</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm">
          <dt className="text-slate-500">Number</dt>
          <dd className="font-mono font-semibold" data-testid="invoice-number">
            {invoice.invoiceNumber}
          </dd>
          <dt className="text-slate-500">Date</dt>
          <dd>{formatDate(invoice.issuedAt, { timeZone: 'Asia/Kolkata' })}</dd>
          {invoice.placeOfSupply && (
            <>
              <dt className="text-slate-500">Place of supply</dt>
              <dd data-testid="place-of-supply">
                {invoice.placeOfSupply.name} ({invoice.placeOfSupply.code})
              </dd>
            </>
          )}
          {invoice.paymentReference && (
            <>
              <dt className="text-slate-500">Payment ref.</dt>
              <dd className="font-mono text-xs [overflow-wrap:anywhere]">{invoice.paymentReference}</dd>
            </>
          )}
        </dl>
      </header>

      {refund && (
        <div
          role="note"
          data-testid="invoice-refunded"
          className="mt-4 rounded border border-slate-900 px-3 py-2 text-sm font-semibold"
        >
          {refund.status === 'partial' ? 'Partly refunded' : 'Refunded'}
          {refund.reference ? ` · Refund reference ${refund.reference}` : ''}
          {refund.at ? ` · ${formatDate(refund.at, { timeZone: 'Asia/Kolkata' })}` : ''}
        </div>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Party title="Sold by" party={invoice.seller} testId="invoice-seller" />
        <Party title="Billed to" party={invoice.buyer} testId="invoice-buyer" />
      </div>

      <table className="mt-6 w-full table-fixed text-sm" data-testid="invoice-lines">
        <thead>
          <tr className="border-b border-slate-400 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="w-8 py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Description</th>
            {tax && <th className="w-20 py-2 pr-2 font-medium">SAC</th>}
            <th className="w-28 py-2 text-right font-medium">{tax ? 'Taxable value' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((line, index) => (
            <tr key={`${line.description}-${index}`} className="border-b border-slate-200 align-top">
              <td className="py-2 pr-2">{index + 1}</td>
              <td className="py-2 pr-2 [overflow-wrap:anywhere]">
                {line.description}
                {line.periodStart && line.periodEnd && (
                  <span className="block text-xs text-slate-500">
                    {formatDate(line.periodStart, { timeZone: 'Asia/Kolkata' })} to{' '}
                    {formatDate(line.periodEnd, { timeZone: 'Asia/Kolkata' })}
                  </span>
                )}
              </td>
              {tax && <td className="py-2 pr-2 font-mono text-xs">{line.sacCode || '—'}</td>}
              <td className="py-2 text-right tabular-nums">{formatPaise(line.taxableValuePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 ml-auto w-full max-w-xs text-sm" data-testid="invoice-totals">
        {tax && (
          <>
            <Row label="Taxable value" value={invoice.taxableValuePaise} />
            {intra ? (
              <>
                <Row label={`CGST @ ${half}%`} value={invoice.cgstPaise} testId="cgst" />
                <Row label={`SGST @ ${half}%`} value={invoice.sgstPaise} testId="sgst" />
              </>
            ) : (
              <Row label={`IGST @ ${invoice.ratePercent}%`} value={invoice.igstPaise} testId="igst" />
            )}
          </>
        )}
        <div className="mt-1 flex justify-between border-t-2 border-slate-900 pt-1.5 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums" data-testid="invoice-total">
            {formatPaise(invoice.totalPaise)}
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm" data-testid="amount-in-words">
        <span className="text-slate-500">Amount in words: </span>
        <span className="font-medium">{invoice.amountInWords}</span>
      </p>

      <footer className="mt-8 space-y-1 border-t border-slate-300 pt-3 text-xs text-slate-600">
        {!tax && invoice.documentType === 'bill_of_supply' && (
          <p>The seller is not registered under GST. No tax is charged on this bill of supply.</p>
        )}
        {invoice.note && <p>{invoice.note}</p>}
        <p>This is a computer-generated document and needs no signature.</p>
      </footer>
    </article>
  );
}

function Row({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums" data-testid={testId}>
        {formatPaise(value)}
      </span>
    </div>
  );
}
