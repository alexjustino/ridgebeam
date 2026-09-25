import type { Weather } from '@/domain/diary';
import type { MessageKey } from '@/i18n/en';

/** What each weather is called on screen: in the form's choice and on every entry that names it. */
export const WEATHER_KEYS: Record<Weather, MessageKey> = {
  sun: 'diary.weather.sun',
  cloud: 'diary.weather.cloud',
  rain: 'diary.weather.rain',
  storm: 'diary.weather.storm',
  wind: 'diary.weather.wind',
  other: 'diary.weather.somethingElse',
};
