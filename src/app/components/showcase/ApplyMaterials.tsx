import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Layers, Lock, Printer } from 'lucide-react';
import { AppSelect } from '../ui/app-select';
import { FieldHelp } from '../help/FieldHelp';
import { PortfolioPreview } from './PortfolioPreview';
import { apiGet } from '../../lib/api';
import type { Portfolio, Resume } from '../../lib/showcase';
import { FEATURE_RESUMES } from '../../lib/features';

export interface Materials {
  portfolioId?: string;
  resumeId?: string;
}
const NONE = '';

/**
 * The "what you'll send" part of applying: a portfolio and a resume (your defaults preselected),
 * a preview of what the employer will see, and a note that they get a frozen copy.
 */
export function ApplyMaterials({
  base,
  value,
  onChange,
  onDetails,
}: {
  base: string;
  value: Materials;
  onChange: (m: Materials) => void;
  /** The chosen portfolio and resume in full, for the cover-letter helper. */
  onDetails?: (d: { portfolio?: Portfolio; resume?: Resume }) => void;
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [detail, setDetail] = useState<Portfolio | null>(null);
  const cache = useRef(new Map<string, Portfolio>());
  const change = useRef(onChange);
  change.current = onChange;
  const details = useRef(onDetails);
  details.current = onDetails;

  useEffect(() => {
    let live = true;
    Promise.all([
      apiGet<{ portfolios?: Portfolio[] }>('/portfolios')
        .then((d) => (d.portfolios || []).filter((p) => p.status !== 'hidden'))
        .catch(() => [] as Portfolio[]),
      FEATURE_RESUMES
        ? apiGet<{ resumes?: Resume[] }>('/resumes')
            .then((d) => d.resumes || [])
            .catch(() => [] as Resume[])
        : Promise.resolve([] as Resume[]),
    ]).then(([p, r]) => {
      if (!live) return;
      setPortfolios(p);
      setResumes(r);
      change.current({ portfolioId: p.find((x) => x.isDefault)?.id, resumeId: r.find((x) => x.isDefault)?.id });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const id = value.portfolioId;
    const resume = (resumes || []).find((r) => r.id === value.resumeId);
    if (!id) {
      setDetail(null);
      details.current?.({ resume });
      return;
    }
    const known = cache.current.get(id);
    if (known) {
      setDetail(known);
      details.current?.({ portfolio: known, resume });
      return;
    }
    let live = true;
    apiGet<{ portfolio: Portfolio }>(`/portfolios/${encodeURIComponent(id)}`)
      .then((d) => {
        cache.current.set(id, d.portfolio);
        if (live) {
          setDetail(d.portfolio);
          details.current?.({ portfolio: d.portfolio, resume });
        }
      })
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [value.portfolioId, value.resumeId, resumes]);

  if (portfolios === null || resumes === null)
    return (
      <p role="status" className="mb-4 text-sm text-slate-400">
        Loading your portfolios…
      </p>
    );
  if (!portfolios.length && !resumes.length)
    return (
      <p className="mb-4 rounded-xl border border-white/10 p-3 text-sm text-slate-400">
        Tip:{' '}
        <Link to={`${base}/portfolios`} className="text-violet-300 underline">
          make a portfolio
        </Link>{' '}
        to send your best work with every application.
      </p>
    );

  const resume = resumes.find((r) => r.id === value.resumeId);
  return (
    <fieldset className="mb-5 space-y-3" data-testid="apply-materials">
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
        What you’ll send
        <FieldHelp topic="Portfolio and resume">
          Your defaults are picked for you. Choose another to fit this opportunity, or send none.
        </FieldHelp>
      </legend>
      {portfolios.length > 0 && (
        <div>
          <label htmlFor="apply-portfolio" className="text-xs text-slate-300">
            Portfolio
          </label>
          <AppSelect
            id="apply-portfolio"
            className="mt-1"
            value={value.portfolioId || NONE}
            onValueChange={(v) => onChange({ ...value, portfolioId: v || undefined })}
            options={[
              ...portfolios.map((p) => ({
                value: p.id,
                label: p.title,
                description: `${p.itemCount ?? 0} pieces${p.isDefault ? ' · your default' : ''}`,
              })),
              { value: NONE, label: 'Don’t attach a portfolio', description: null },
            ]}
          />
        </div>
      )}
      {resumes.length > 0 && (
        <div>
          <label htmlFor="apply-resume" className="text-xs text-slate-300">
            Resume
          </label>
          <AppSelect
            id="apply-resume"
            className="mt-1"
            value={value.resumeId || NONE}
            onValueChange={(v) => onChange({ ...value, resumeId: v || undefined })}
            options={[
              ...resumes.map((r) => ({
                value: r.id,
                label: r.title,
                description: `${r.entryCount ?? 0} entries${r.isDefault ? ' · your default' : ''}`,
              })),
              { value: NONE, label: 'Don’t attach a resume', description: null },
            ]}
          />
        </div>
      )}
      {(detail || resume) && (
        <div
          className="rounded-xl border border-white/10 bg-black/25 p-3"
          aria-label="What the employer will see"
          role="group"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            What the employer will see
          </p>
          {detail && <PortfolioPreview portfolio={detail} members={detail.items || []} />}
          {resume && (
            <p
              className={`flex flex-wrap items-center gap-2 text-sm text-slate-300 ${detail ? 'mt-3 border-t border-white/10 pt-3' : ''}`}
            >
              <Layers size={14} aria-hidden="true" className="text-violet-300" />
              Resume: <b className="font-medium text-white">{resume.title}</b> · {resume.entryCount ?? 0} entries
              <Link
                to={`${base}/resumes/${resume.id}/print`}
                className="inline-flex items-center gap-1 text-violet-300 underline"
                target="_blank"
              >
                <Printer size={12} aria-hidden="true" />
                Preview
              </Link>
            </p>
          )}
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-slate-400" data-testid="frozen-note">
        <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-teal-300" />
        The employer gets a frozen copy, taken when you apply. Editing your portfolio or resume later won’t change what
        they see.
      </p>
    </fieldset>
  );
}
