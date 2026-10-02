import { App } from '@/app/App';
import { BUILT_IN_SETTINGS } from '@/data/commands';
import { useSettings } from '@/data/queries';
import { TitleBar } from '@/features/shell/TitleBar';

/**
 * One bundle, one window. The indirection stays so a second window can be routed here later
 * without touching `main.tsx`.
 *
 * It is also where the window waits for what it was set to: the theme and the language are read
 * first and the shell is drawn with them, never before, so what a person sees on the first frame
 * is what they will still see on the second.
 *
 * A settings table that cannot answer is not a reason to refuse to start. The built-in choices
 * stand, the window opens, and the Settings screen is where that failure is reported.
 */
export function Root() {
  const settings = useSettings();

  // The shape that is coming, and no spinner (DESIGN_SYSTEM §6): the chrome is already the
  // chrome, and only the content region is waiting. On a local table this is one frame.
  if (settings.isPending) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg">
        <TitleBar />
        <div className="min-h-0 flex-1 bg-layer" />
      </div>
    );
  }

  return <App settings={settings.data ?? BUILT_IN_SETTINGS} />;
}
