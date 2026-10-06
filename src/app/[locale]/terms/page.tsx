import {LegalPage} from '@/components/LegalPage';

const SECTIONS = ['services', 'consultation', 'userObligations', 'intellectualProperty', 'limitationOfLiability', 'modifications', 'governingLaw', 'contact'] as const;

export default async function TermsPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  return <LegalPage locale={locale} namespace="Terms" sections={SECTIONS} />;
}
