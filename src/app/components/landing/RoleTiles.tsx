import { Link } from 'react-router';
import { Photo } from '../media/Photo';
import { SEO_CITIES, SEO_ROLES, hireLinkText, hirePagePath } from '../../lib/seoPages';
import { rolePhoto } from './photos';

/** The URL slug for a display name from the fixed city list; Mumbai when it is not on it. */
const citySlug = (name: string) => SEO_CITIES.find(([, label]) => label === name)?.[0] ?? 'mumbai';

/**
 * "Find by role": one photo tile for each of the 12 hire-page roles, linking to the role × city page
 * (/hire/:role/:city). The tiles are fixed, so they never wait on the API or disappear.
 */
export function RoleTiles({ city }: { city: string }) {
  const slug = citySlug(city);
  return (
    <section aria-labelledby="roles-title" className="px-4 py-16 sm:px-6 md:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="roles-title" className="text-2xl font-black md:text-3xl">
          Find by role
        </h2>
        <p className="mt-2 text-slate-300">Live in {city}. Delhi, Bengaluru, Pune and Goa are coming.</p>
        <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="role-tiles">
          {SEO_ROLES.map(([roleSlug, label]) => {
            const photo = rolePhoto(roleSlug);
            return (
              <li key={roleSlug}>
                <Link
                  to={hirePagePath(roleSlug, slug)}
                  className="group relative block aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
                >
                  <Photo
                    src={photo.src}
                    alt=""
                    width={photo.width}
                    height={photo.height}
                    sizes="(min-width: 1024px) 24vw, (min-width: 768px) 32vw, 48vw"
                    className="size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent"
                  />
                  <span className="absolute inset-x-0 bottom-0 p-3 text-sm font-bold leading-5 text-white sm:p-4 sm:text-base">
                    {hireLinkText(label, city)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
