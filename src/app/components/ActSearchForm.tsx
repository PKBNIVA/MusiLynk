import { FormEvent, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useTaxonomy } from '../lib/useTaxonomy';
import { AppSelect } from './ui/app-select';

const ACT_TYPES = ['solo', 'duo', 'trio', 'band', 'ensemble', 'dj', 'wedding-band', 'corporate-band', 'folk-group'];

export type ActFilterValues = { q: string; city: string; type: string };

type Props = {
  values: ActFilterValues;
  /** The text fields, applied on submit. */
  onSearch: (changes: Pick<ActFilterValues, 'q' | 'city'>) => void;
  /** The act type select applies at once. */
  onType: (type: string) => void;
  busy: boolean;
  idPrefix: string;
};

/** Search box, city and act type for act discovery (SRCH-11): /book-music and the signed-in booking page. */
export function ActSearchForm({ values, onSearch, onType, busy, idPrefix }: Props) {
  const taxonomy = useTaxonomy();
  const types = taxonomy?.actTypes?.length ? taxonomy.actTypes : ACT_TYPES;
  const [q, setQ] = useState(values.q),
    [city, setCity] = useState(values.city);
  useEffect(() => {
    setQ(values.q);
    setCity(values.city);
  }, [values.q, values.city]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch({ q, city });
  };
  return (
    <form role="search" onSubmit={submit} className="grid md:grid-cols-[1.3fr_1fr_0.8fr_auto] gap-3 mt-7">
      <label htmlFor={`${idPrefix}-q`} className="sr-only">
        Search acts
      </label>
      <Input
        id={`${idPrefix}-q`}
        placeholder="Singer, jazz trio, wedding band…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="bg-white/5 border-white/15"
      />
      <label htmlFor={`${idPrefix}-city`} className="sr-only">
        City
      </label>
      <Input
        id={`${idPrefix}-city`}
        placeholder="City"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        className="bg-white/5 border-white/15"
      />
      <label htmlFor={`${idPrefix}-type`} className="sr-only">
        Act type
      </label>
      <AppSelect
        id={`${idPrefix}-type`}
        value={values.type}
        onValueChange={onType}
        className="md:w-48"
        options={[
          { value: '', label: 'Any act type' },
          ...types,
          ...(values.type && !types.includes(values.type) ? [values.type] : []),
        ]}
      />
      <Button type="submit" disabled={busy}>
        <Search size={16} className="mr-2" />
        Search
      </Button>
    </form>
  );
}
