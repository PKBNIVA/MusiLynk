import { useState } from 'react';
import { Building2, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BillingDetailsForm } from './BillingDetailsForm';
import type { BillingProfileApi } from '../../lib/billingProfile';
import { draftFrom, emptyDraft, type BillingProfileDraft, type BillingProfileErrors } from '../../lib/billingProfile';

/** "Billing details": who invoices are made out to, with an edit dialog. Shared by both billing pages. */
export function BillingDetailsCard({ api }: { api: BillingProfileApi }) {
  const { data, failed, save } = api;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BillingProfileDraft | null>(null);
  const [errors, setErrors] = useState<BillingProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  if (failed || !data) return null;
  const profile = data.profile;

  const openEditor = () => {
    setDraft(profile ? draftFrom(profile) : emptyDraft(data.defaults));
    setErrors({});
    setFormError('');
    setOpen(true);
  };
  async function submit() {
    if (!draft || saving) return;
    setSaving(true);
    setFormError('');
    const result = await save(draft);
    setSaving(false);
    if (result.ok) {
      toast.success('Billing details saved. New invoices will use them.');
      setOpen(false);
    } else {
      setErrors(result.errors);
      setFormError(result.message);
    }
  }

  return (
    <Card className="mt-8 border-white/10 bg-white/[.04]" data-testid="billing-details">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          {profile?.buyerType === 'business' ? (
            <Building2 className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
          ) : (
            <UserRound className="mt-0.5 shrink-0 text-violet-300" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h2 className="font-semibold">Billing details</h2>
            {profile ? (
              <div className="mt-1 text-sm text-slate-300" data-testid="billing-details-summary">
                <p>
                  {profile.legalName} · {profile.buyerType === 'business' ? 'Business' : 'Individual'}
                </p>
                {profile.gstin && <p className="font-mono text-xs text-slate-400">GSTIN {profile.gstin}</p>}
                <p className="[overflow-wrap:anywhere]">
                  {[profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                <p className="text-slate-400">Invoices go to {profile.billingEmail}</p>
              </div>
            ) : (
              <p className="mt-1 max-w-xl text-sm text-slate-300">
                Add your name and address, or your business and GSTIN, so your invoices are made out correctly. Until
                then they use your account name.
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={openEditor} data-testid="billing-details-edit">
          {profile ? 'Edit billing details' : 'Add billing details'}
        </Button>
      </CardContent>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Billing details</DialogTitle>
            <DialogDescription>
              New invoices use these details. Invoices you already have keep the details they were issued with.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="space-y-4"
            >
              <BillingDetailsForm
                idPrefix="bd"
                draft={draft}
                errors={errors}
                states={data.states}
                onChange={(key, value) => {
                  setDraft({ ...draft, [key]: value });
                  if (errors[key]) setErrors({ ...errors, [key]: undefined });
                }}
              />
              {formError && (
                <p role="alert" className="text-sm text-rose-300">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save billing details'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
