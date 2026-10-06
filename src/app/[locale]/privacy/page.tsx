import {LegalPage} from '@/components/LegalPage';

const SECTIONS = ['dataCollection', 'dataUsage', 'dataStorage', 'dataSharing', 'security', 'yourRights', 'cookies', 'contact'] as const;

export default async function PrivacyPage({params}: {params: Promise<{locale: string}>}) {
  const {locale} = await params;
  return <LegalPage locale={locale} namespace="Privacy" sections={SECTIONS} />;
}
