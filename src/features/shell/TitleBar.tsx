import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';

import { Mark } from './Mark';

/**
 * The application's own title bar.
 *
 * The window is drawn without system decorations so the Mica material runs behind the chrome,
 * the way modern Windows applications are built. The cost is that the three window controls are
 * ours to draw, including their Fluent hover behaviour — close turns red, the others take the
 * neutral hover.
 *
 * It carries the mark, the product's name, and — when a work is open — the work's name, so the
 * window always says which work it is showing.
 *
 * Known gap, tracked rather than hidden: Snap Layouts (hovering the maximise button to choose a
 * layout) needs native `WM_NCHITTEST` handling that a custom title bar does not get for free.
 * Maximise itself works; the hover flyout does not appear yet.
 */

/**
 * Resolved lazily, never at module scope.
 *
 * `getCurrentWindow` reads state the Tauri host injects into the page. Calling it while the
 * module is being imported ties the whole component tree to the host being present at that
 * instant — which makes the interface impossible to open anywhere else, including in a browser
 * to check a layout.
 */
function useAppWindow() {
  return useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);
}

export function TitleBar({ workName = null }: { workName?: string | null }) {
  const { t } = useI18n();
  const appWindow = useAppWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;

    let active = true;
    const sync = async () => {
      const value = await appWindow.isMaximized();
      if (active) setMaximized(value);
    };
    void sync();
    const unlisten = appWindow.onResized(() => void sync());
    return () => {
      active = false;
      void unlisten.then((off) => off());
    };
  }, [appWindow]);

  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between border-b border-stroke-subtle bg-layer-alt pl-3 select-none"
    >
      <span
        data-tauri-drag-region
        className="flex min-w-0 items-center gap-2 text-caption text-fg-secondary"
      >
        {/* The mark, at the size Windows draws a window icon, in the ink of the text beside it. */}
        <Mark size={16} className="text-accent" />
        <span data-tauri-drag-region className="font-semibold">
          Ridgebeam
        </span>
        {workName !== null && (
          <>
            <span aria-hidden="true" data-tauri-drag-region>
              ·
            </span>
            <span data-tauri-drag-region className="truncate text-fg">
              {workName}
            </span>
          </>
        )}
      </span>

      <div className="flex shrink-0">
        <WindowButton
          label={t('shell.window.minimise')}
          onClick={() => void appWindow?.minimize()}
          path="M 0,5 H 10"
        />
        <WindowButton
          label={maximized ? t('shell.window.restore') : t('shell.window.maximise')}
          onClick={() => void appWindow?.toggleMaximize()}
          path={
            maximized
              ? 'M 2,0.5 H 9.5 V 8 M 0.5,2.5 H 7.5 V 9.5 H 0.5 Z'
              : 'M 0.5,0.5 H 9.5 V 9.5 H 0.5 Z'
          }
        />
        <WindowButton
          label={t('shell.window.close')}
          onClick={() => void appWindow?.close()}
          path="M 0,0 L 10,10 M 10,0 L 0,10"
          danger
        />
      </div>
    </header>
  );
}

function WindowButton({
  label,
  onClick,
  path,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  path: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'grid h-8 w-12 place-items-center text-fg transition-colors duration-100 ease-easy',
        danger ? 'hover:bg-danger hover:text-fg-on-accent' : 'hover:bg-card-hover',
      ].join(' ')}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
  );
}
