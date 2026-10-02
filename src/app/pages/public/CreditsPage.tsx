import { Link } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { usePageMeta } from '../../components/PageMeta';
import { Photo } from '../../components/media/Photo';
import { IMAGE_CREDITS, creditLine } from './imageCredits';

/** Every editorial photograph on the site, with author, licence and source. Photos are never used as anyone's profile picture. */
export default function CreditsPage() {
  usePageMeta(
    'Photo credits',
    'The photographers and licences behind the pictures on MusiLynk, from Wikimedia Commons under Creative Commons and public-domain terms.',
    { canonicalPath: '/credits' },
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-5xl px-5 py-14">
        <h1 className="text-4xl font-bold sm:text-5xl">Photo credits</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-400">
          The photographs on MusiLynk come from Wikimedia Commons and are used under their Creative Commons or
          public-domain licences. They show musicians at work; they are never attached to anyone’s profile. Generated
          artwork on profiles and opportunities is not a photograph and is not credited here.
        </p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2">
          {IMAGE_CREDITS.map((credit) => (
            <li key={credit.file} className="overflow-hidden rounded-xl border border-white/10 bg-white/[.035]">
              <Photo
                src={`/img/${credit.file}`}
                alt={credit.alt}
                width={800}
                height={Math.round((800 * credit.height) / credit.width)}
                sizes="(min-width: 640px) 50vw, 100vw"
                className="aspect-[3/2] w-full object-cover"
              />
              <div className="p-4 text-sm">
                <p className="font-semibold text-white">{credit.subject}</p>
                <p className="mt-1 leading-6 text-slate-300">{creditLine(credit)}</p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <a
                    className="text-violet-300 underline underline-offset-4 hover:text-violet-200"
                    href={credit.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Source
                  </a>
                  {credit.licenceUrl && (
                    <a
                      className="text-violet-300 underline underline-offset-4 hover:text-violet-200"
                      href={credit.licenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Licence
                    </a>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-slate-400">
          Spotted a mistake or want a photo removed?{' '}
          <Link to="/contact" className="underline hover:text-white">
            Tell us
          </Link>{' '}
          and we will correct it.
        </p>
      </main>
    </div>
  );
}
