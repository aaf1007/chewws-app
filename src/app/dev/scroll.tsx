import { router, useLocalSearchParams } from 'expo-router';

import { Button, Screen, StepRow } from '@/ui';

// Dev-only: a long scrolling Screen, opened from the UI gallery under the navigation header
// (`/dev/scroll`) or without one (`/dev/scroll?header=none`, as on a tab), so the bar and its
// compact title can be checked in both.

const ROWS = Array.from({ length: 30 }, (_, i) => i + 1);

export default function ScrollSample() {
  const { header } = useLocalSearchParams<{ header?: string }>();
  const title = header === 'none' ? 'Without a header' : 'Under a header';

  return (
    <Screen title={title} scroll>
      <Button label="Back to the gallery" variant="outlined" onPress={() => router.back()} />
      {ROWS.map((n) => (
        <StepRow key={n} number={n} text={`Row ${n} of a long scrolling screen.`} />
      ))}
    </Screen>
  );
}
