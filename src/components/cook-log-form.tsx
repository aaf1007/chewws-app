import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { messageOf } from '@/auth/errors';
import type { CookLog, CookLogInput, CookLogPhotoId, UserId } from '@/data';
import { data } from '@/data/app';
import { Button, CompanionPicker, DayPicker, PhotoStrip, SectionHeader, Text, TextField, localToday, spacing } from '@/ui';

import { pickImage } from './picked-image';

/** At most this many photos on a Cook Log (decisions 16); the data layer checks it too. */
const MAX_PHOTOS = 4;
/** How far back the day pills go. */
const DAYS_BACK = 60;

/** A photo in the form: one already on the log, or one just picked and scaled down. */
type FormPhoto = { key: string; uri: string | null } & (
  | { kind: 'saved'; id: CookLogPhotoId }
  | { kind: 'new'; jpeg: ArrayBuffer }
);

/** Someone the user can pick as cooked with. */
export type Companion = { id: UserId; username: string | null };

let lastKey = 0;

/**
 * The Cook Log form shared by "Add Cook Log" and "Edit Cook Log": the day, notes, photos and the
 * Friends cooked with. It hands what's filled in to `onSubmit`, which throws with what to tell the
 * user when it wasn't saved. A companion on the log who isn't a Friend any more stays chosen.
 */
export function CookLogForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: CookLog;
  submitLabel: string;
  onSubmit: (input: CookLogInput, people: readonly Companion[]) => Promise<void>;
}) {
  const [cookedOn, setCookedOn] = useState(initial?.cookedOn ?? localToday());
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [companions, setCompanions] = useState<UserId[]>(initial?.companions.map((c) => c.id) ?? []);
  const [photos, setPhotos] = useState<FormPhoto[]>(
    () => initial?.photos.map((p) => ({ key: p.id, uri: p.url, kind: 'saved', id: p.id })) ?? [],
  );
  const [friends, setFriends] = useState<Companion[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    data
      .listFriends()
      .then((found) => live && setFriends(found.map((f) => ({ id: f.id, username: f.username }))))
      .catch(() => live && setFriends([]));
    return () => {
      live = false;
    };
  }, []);

  // The log's companions first (a former Friend among them), then the other Friends.
  const people = [
    ...(initial?.companions ?? []),
    ...(friends ?? []).filter((f) => !initial?.companions.some((c) => c.id === f.id)),
  ];

  const toggle = (id: string) =>
    setCompanions((chosen) => {
      const person = people.find((p) => p.id === id);
      if (!person) return chosen;
      return chosen.includes(person.id) ? chosen.filter((c) => c !== person.id) : [...chosen, person.id];
    });

  const addPhoto = () => {
    setError(null);
    setAdding(true);
    pickImage()
      .then((picked) => {
        if (picked) setPhotos((all) => [...all, { key: `new-${++lastKey}`, uri: picked.uri, kind: 'new', jpeg: picked.jpeg }]);
      })
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setAdding(false));
  };

  const save = () => {
    setSaving(true);
    setError(null);
    onSubmit(
      {
        cookedOn,
        notes,
        companions,
        photos: photos.map((p) => (p.kind === 'saved' ? { kind: 'saved', id: p.id } : { kind: 'new', jpeg: p.jpeg })),
      },
      people,
    ).catch((e: unknown) => {
      setError(messageOf(e));
      setSaving(false);
    });
  };

  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="When" />
        <DayPicker value={cookedOn} onChange={(day) => day && setCookedOn(day)} range="past" days={DAYS_BACK} testID="cooked-on" />
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="Cooked with" />
        {friends === null ? null : people.length === 0 ? (
          <Text tone="textMuted">Add Friends to log who you cooked with.</Text>
        ) : (
          <CompanionPicker
            people={people.map((p) => ({ id: p.id, username: p.username ?? 'someone' }))}
            chosen={companions}
            onToggle={toggle}
          />
        )}
      </View>

      <TextField
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="How did it go? What would you change?"
        multiline
        testID="cook-log-notes"
      />

      <View style={{ gap: spacing.sm }}>
        <SectionHeader title={`Photos (${photos.length} of ${MAX_PHOTOS})`} />
        <PhotoStrip
          photos={photos}
          onRemove={(key) => setPhotos((all) => all.filter((p) => p.key !== key))}
          onAdd={addPhoto}
          max={MAX_PHOTOS}
          adding={adding}
          disabled={saving}
        />
      </View>

      {error ? <Text tone="danger">{error}</Text> : null}
      <Button label={saving ? 'Saving…' : submitLabel} icon="checkmark" disabled={saving || adding} onPress={save} testID="save-cook-log" />
    </>
  );
}
