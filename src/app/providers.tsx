import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { I18nProvider } from '@/i18n/react';
import { Announcer } from '@/ui/Announcer';

/**
 * The query client.
 *
 * The defaults assume a network. This is a local process reading a file on the
 * same machine, so most of them are wrong here: nothing goes stale on a timer,
 * because the only thing that changes the data is this application; and a failed
 * command is a real failure worth showing, not a blip worth retrying three
 * times behind the person's back.
 */
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      {/* The language reads the settings, so it sits inside the client and around everything
          that shows a word. */}
      <I18nProvider>{children}</I18nProvider>
      {/* The live regions, present from the first render in every window. */}
      <Announcer />
    </QueryClientProvider>
  );
}
