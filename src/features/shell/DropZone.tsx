import {
  ArrowDownload24Regular,
  Dismiss20Regular,
  Prohibited24Regular,
} from '@fluentui/react-icons';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useI18n, type I18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';

import type { Destination } from './destinations';
import { routeDrop, type DropPlace, type DropRoute } from './drop';
import { DropContext, type DropHandler, type DropRegistry } from './dropTarget';

/**
 * Why a drop was not taken anywhere, kept until it is dismissed or the screen changes. `no-snag`: the
 * Plan takes a photo only for a snag being raised or fixed, and none is open (E4).
 */
type Notice = 'no-work' | 'elsewhere' | 'no-snag';

const NoticeContext = createContext<{ notice: Notice | null; dismiss: () => void }>({
  notice: null,
  dismiss: () => undefined,
});

/** The sentence that says where files can be dropped, for a drop that was taken nowhere. */
function nowhereText({ t }: I18n, why: Notice): string {
  if (why === 'no-snag') return t('drop.noSnag');
  const places = { diary: t('nav.diary'), documents: t('nav.documents') };
  return t(why === 'no-work' ? 'drop.noWork' : 'drop.elsewhere', places);
}

const HINT_KEYS = {
  diary: 'drop.hint.diary',
  documents: 'drop.hint.documents',
  snag: 'drop.hint.snag',
} as const satisfies Record<DropPlace, string>;

/** What the overlay says a drop would do here, in one or two sentences. */
function hintText(
  i18n: I18n,
  route: DropRoute,
  placed: (place: DropPlace) => boolean,
): { takes: boolean; main: string; left: string | null } {
  const { t, tp } = i18n;
  if (route.kind === 'nowhere') {
    return { takes: false, main: nowhereText(i18n, route.why), left: null };
  }
  // A snag's photo field is on screen only while a snag is raised or fixed: otherwise the Plan
  // takes nothing, and the overlay says where to go rather than promising a drop it will refuse.
  if (route.place === 'snag' && !placed('snag')) {
    return { takes: false, main: nowhereText(i18n, 'no-snag'), left: null };
  }
  const main =
    route.taken.length === 0 ? t('drop.hint.none') : tp(HINT_KEYS[route.place], route.taken.length);
  const left =
    route.refused.length === 0
      ? null
      : tp('drop.hint.left', route.refused.length, { names: route.refused.join(', ') });
  return { takes: route.taken.length > 0, main, left };
}

/**
 * Files dropped from Explorer onto the window (slice U1, decision 1): **one** listener, at the
 * shell, for the whole window — Tauri's own drag-and-drop event, which carries the absolute paths a
 * dialog would have returned. While files hover, a full-window overlay says what a drop would do on
 * this screen (`drop-hint`); on the drop, `routeDrop` decides, and the place on screen that takes
 * files — registered with `useDropTarget` — takes them through the same function its dialog uses.
 * Anywhere else nothing happens, and a sentence says where files can be dropped.
 *
 * Outside Tauri — a test, a browser opened on the dev server — there is no webview to listen to,
 * and the shell is the same shell without drops.
 */
export function DropZone({
  destination,
  workOpen,
  children,
}: {
  destination: Destination;
  workOpen: boolean;
  children: ReactNode;
}) {
  const i18n = useI18n();
  // Each place keeps the handlers on screen in the order they came; the latest takes a drop — a
  // dialog opened over a form takes it while open, and the form takes it again once it closes.
  const handlers = useRef(new Map<DropPlace, DropHandler[]>());
  const registry = useMemo<DropRegistry>(
    () => ({
      register: (place, handler) => {
        handlers.current.set(place, [...(handlers.current.get(place) ?? []), handler]);
        return () => {
          const left = (handlers.current.get(place) ?? []).filter((each) => each !== handler);
          if (left.length === 0) handlers.current.delete(place);
          else handlers.current.set(place, left);
        };
      },
    }),
    [],
  );
  const handlerOf = (place: DropPlace): DropHandler | undefined =>
    handlers.current.get(place)?.at(-1);
  // The paths over the window, and the places on screen as they stood when the files came in.
  const [hovering, setHovering] = useState<{
    paths: readonly string[];
    placed: ReadonlySet<DropPlace>;
  } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);

  // A sentence about the last drop belongs to the screen it was dropped on.
  const [noticeOn, setNoticeOn] = useState(destination);
  if (noticeOn !== destination) {
    setNoticeOn(destination);
    setNotice(null);
  }

  // The listener is registered once; what it decides with is always the screen on show now.
  const drop = useRef<(paths: readonly string[]) => void>(() => undefined);
  useEffect(() => {
    drop.current = (paths) => {
      const route = routeDrop({ destination, workOpen, paths });
      const handler = route.kind === 'take' ? handlerOf(route.place) : undefined;
      if (route.kind === 'take' && handler !== undefined) {
        handler(route.taken, route.refused);
        return;
      }
      // A place that is not on screen yet — the diary still being read, no snag being raised or
      // fixed — takes nothing either.
      const why: Notice =
        route.kind === 'nowhere' ? route.why : route.place === 'snag' ? 'no-snag' : 'elsewhere';
      setNotice(why);
      announce(nowhereText(i18n, why));
    };
  });

  useEffect(() => {
    let webview: ReturnType<typeof getCurrentWebview>;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }
    let active = true;
    let stop: (() => void) | null = null;
    webview
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter') {
          setNotice(null);
          setHovering({ paths: payload.paths, placed: new Set(handlers.current.keys()) });
        } else if (payload.type === 'leave') {
          setHovering(null);
        } else if (payload.type === 'drop') {
          setHovering(null);
          drop.current(payload.paths);
        }
      })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlisten();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  const hint =
    hovering === null
      ? null
      : hintText(i18n, routeDrop({ destination, workOpen, paths: hovering.paths }), (place) =>
          hovering.placed.has(place),
        );

  return (
    <DropContext.Provider value={registry}>
      <NoticeContext.Provider value={{ notice, dismiss }}>
        {children}
        {hint !== null && (
          <div
            data-testid="drop-hint"
            aria-live="polite"
            className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-overlay p-6"
          >
            <div
              className={[
                'flex max-w-md flex-col items-center gap-2 rounded-xl border-2 border-dashed',
                'bg-flyout p-6 text-center shadow-dialog',
                hint.takes ? 'border-accent' : 'border-stroke-strong',
              ].join(' ')}
            >
              {hint.takes ? (
                <ArrowDownload24Regular aria-hidden="true" className="text-accent" />
              ) : (
                <Prohibited24Regular aria-hidden="true" className="text-fg-secondary" />
              )}
              <p className="text-body-lg font-semibold text-fg">{hint.main}</p>
              {hint.left !== null && <p className="text-body text-fg-secondary">{hint.left}</p>}
            </div>
          </div>
        )}
      </NoticeContext.Provider>
    </DropContext.Provider>
  );
}

/**
 * The sentence after a drop that was taken nowhere: where files can be dropped. Shown at the top of
 * the content region, where the person is looking, until it is dismissed or the screen changes.
 */
export function DropNotice() {
  const i18n = useI18n();
  const { notice, dismiss } = useContext(NoticeContext);
  if (notice === null) return null;
  return (
    <div data-testid="drop-status" className="mx-auto w-full max-w-3xl px-6 pt-6">
      <InfoBar severity="info" title={i18n.t('drop.notTaken')}>
        <div className="flex items-start justify-between gap-2">
          <p>{nowhereText(i18n, notice)}</p>
          <IconButton
            label={i18n.t('common.close')}
            icon={<Dismiss20Regular />}
            data-testid="drop-status-close"
            onClick={dismiss}
          />
        </div>
      </InfoBar>
    </div>
  );
}
