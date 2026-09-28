import { useEffect } from 'react';

// First focusable element on every page: lets keyboard and screen-reader users jump past navigation.
export function SkipLink() {
  // The link's href="#main" target must exist and be focusable *before* it is ever clicked (axe's
  // skip-link rule checks this statically). Every page renders its own <main>, so give it the id
  // and a permanent tabIndex here, once, instead of touching every page.
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    if (!main.id) main.id = 'main';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }, []);
  const skip = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    event.preventDefault();
    if (!main.id) main.id = 'main';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    main.scrollIntoView({ block: 'start' });
  };
  return (
    <a
      href="#main"
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950 focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
}
