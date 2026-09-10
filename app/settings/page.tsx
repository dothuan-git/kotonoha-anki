import { SettingsScreen } from '@/components/SettingsScreen';
import { getSettings } from '@/lib/db/queries';
import { auth } from '@/lib/auth';

export default async function SettingsPage() {
  const [settings, session] = await Promise.all([getSettings(), auth()]);
  return <SettingsScreen settings={settings} email={session?.user?.email ?? null} />;
}
