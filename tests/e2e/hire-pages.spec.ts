import { expect, test } from '@playwright/test';
import { mockSignupApi } from './support/signup-fixtures';

// Role × city hire pages (/hire/:role/:city): the landing page's "Popular searches" block opens
// one, and its urgent CTA carries the role and city into the urgent request form.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const HIRE_PAGE_RESPONSE = {
  role: { slug: 'drummer', label: 'Drummer' },
  city: { slug: 'mumbai', name: 'Mumbai' },
  counts: { professionals: 12, verified: 5, availableThisWeek: 3 },
  featured: [
    {
      id: 'pro-1',
      name: 'Asha Rao',
      role: 'jobseeker',
      headline: 'Session drummer',
      location: 'Mumbai',
      verified: true,
      skills: [],
      genres: [],
      instruments: [],
      languages: [],
      credits: [],
      openTo: [],
      roles: ['Drummer'],
      gear: [],
      software: [],
    },
  ],
  relatedRoles: [{ slug: 'guitarist', label: 'Guitarist', count: 9 }],
  nearbyCities: [{ slug: 'pune', name: 'Pune' }],
  indexable: true,
  ratesPath: '/rates/mumbai',
  faq: [
    {
      question: 'How much does a session drummer in Mumbai charge?',
      answer: 'Rates vary by experience and event; ask for a quote through Verse.',
    },
    {
      question: 'How fast can I book a drummer in Mumbai?',
      answer: 'Most urgent requests get a first response within hours.',
    },
    { question: 'Are drummers on Verse in Mumbai verified?', answer: 'Every profile shows real, reviewable work.' },
    { question: 'What does it cost to hire a drummer for a gig in Mumbai?', answer: 'See rates at /rates/mumbai.' },
  ],
};

test("the landing page's popular searches open a hire page, whose urgent CTA prefills the request", async ({
  page,
}) => {
  await mockSignupApi(page);
  await page.route('**/api/public/hire-pages/drummer/mumbai', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HIRE_PAGE_RESPONSE) }),
  );

  await page.goto('/');
  await page.getByRole('link', { name: 'Hire a drummer in Mumbai' }).click();
  await expect(page).toHaveURL(/\/hire\/drummer\/mumbai$/);
  await expect(page.getByRole('heading', { name: 'Hire a verified drummer in Mumbai' })).toBeVisible();
  await expect(page.getByText('Asha Rao')).toBeVisible();

  await page.getByTestId('urgent-cta').click();
  await expect(page).toHaveURL(/\/urgent\?role=Drummer&city=Mumbai$/);
  // Single-value fields show the prefilled value in the combobox itself, not as a removable chip.
  await expect(page.getByRole('combobox', { name: 'Role needed' })).toHaveValue('Drummer');
  await expect(page.getByRole('combobox', { name: 'City' })).toHaveValue('Mumbai');
});
