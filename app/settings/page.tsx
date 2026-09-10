import { SettingsScreen } from '@/components/SettingsScreen';
import { getSettings } from '@/lib/actions/settings';
import { auth } from '@/lib/auth';

export default async function SettingsPage() {
  const [settings, session] = await Promise.all([getSettings(), auth()]);
  return <SettingsScreen settings={settings} email={session?.user?.email ?? null} />;
}
