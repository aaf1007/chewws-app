import { formatDate, localToday } from '@/ui';

/**
 * When two people became Friends, as the app writes it whatever the phone's language: "Friends
 * since 2 Nov 2026", the day it was on this phone.
 */
export const friendsSince = (iso: string) => `Friends since ${formatDate(localToday(new Date(iso)))}`;
