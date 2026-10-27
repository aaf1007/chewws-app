// Access-rule tests for ticket 05: the screenshots users add live in the private Storage bucket
// recipe-images, at {user id}/{recipe id}.jpg, readable and writable only by that user. Users call
// Storage and PostgREST directly with their own session, as an attacker would. A Draft can't be
// pointed at someone else's image (the builder reads images as the service role and sends them to
// Claude), and a caption can't be added to someone else's Draft.
import { expect, test } from 'vitest';

import type { RecipeId } from '../src/data';
import { NO_CAPTION, PASTED_CAPTION, UNREADABLE } from '../supabase/functions/_shared/draft-fixtures';
import { createTestClient, signInAttacker, type Attacker } from './access-harness';
import { SCREENSHOT_BASE64, screenshotBytes } from './screenshot-fixture';

const REEL = 'https://www.instagram.com/reel/C1a2b3c4d5e/';
const BUCKET = 'recipe-images';

/** An owner's Instagram Draft with a screenshot, built, and the path of that screenshot. */
async function draftWithScreenshot(owner: Attacker): Promise<{ id: RecipeId; path: string }> {
  const { recipeId } = await owner.data.saveFromLink({ url: REEL, screenshot: screenshotBytes() });
  await owner.drafts.settled();
  return { id: recipeId, path: `${owner.userId}/${recipeId}.jpg` };
}

/** The bytes at `path`, downloaded as `who`; null when they can't. */
async function downloaded(who: Attacker, path: string): Promise<string | null> {
  const { data, error } = await who.client.storage.from(BUCKET).download(path);
  return error ? null : Buffer.from(await data.arrayBuffer()).toString('base64');
}

const otherJpeg = () => {
  const bytes = new Uint8Array(screenshotBytes());
  bytes[bytes.length - 3] ^= 0xff;
  return bytes.buffer;
};

test('the owner can read their own screenshot; a stranger can’t download it, sign a link to it or list it', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { path } = await draftWithScreenshot(owner);

  expect(await downloaded(owner, path)).toBe(SCREENSHOT_BASE64);

  expect(await downloaded(stranger, path)).toBeNull();
  const signed = await stranger.client.storage.from(BUCKET).createSignedUrl(path, 3600);
  expect(signed.data).toBeNull();
  expect(signed.error).not.toBeNull();
  const listed = await stranger.client.storage.from(BUCKET).list(owner.userId);
  expect(listed.data ?? []).toEqual([]);
  const ownList = await owner.client.storage.from(BUCKET).list(owner.userId);
  expect(ownList.data?.map((file) => file.name)).toEqual([path.split('/')[1]]);
});

test('the bucket is private: no public link and no anonymous read', async () => {
  const owner = await signInAttacker('owner');
  const { path } = await draftWithScreenshot(owner);
  const anon = createTestClient();

  const publicLink = owner.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  expect((await fetch(publicLink)).ok).toBe(false);
  const anonDownload = await anon.storage.from(BUCKET).download(path);
  expect(anonDownload.data).toBeNull();
  const anonUpload = await anon.storage.from(BUCKET).upload(`${owner.userId}/x.jpg`, screenshotBytes(), { contentType: 'image/jpeg' });
  expect(anonUpload.error).not.toBeNull();
});

test('a stranger can’t upload into, overwrite or delete from someone else’s folder', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { path } = await draftWithScreenshot(owner);

  const plant = await stranger.client.storage
    .from(BUCKET)
    .upload(`${owner.userId}/planted.jpg`, screenshotBytes(), { contentType: 'image/jpeg' });
  const overwrite = await stranger.client.storage
    .from(BUCKET)
    .upload(path, otherJpeg(), { contentType: 'image/jpeg', upsert: true });
  const replace = await stranger.client.storage.from(BUCKET).update(path, otherJpeg(), { contentType: 'image/jpeg' });
  const remove = await stranger.client.storage.from(BUCKET).remove([path]);

  expect(plant.error).not.toBeNull();
  expect(overwrite.error).not.toBeNull();
  expect(replace.error).not.toBeNull();
  expect(remove.data ?? []).toEqual([]);
  expect(await downloaded(owner, path)).toBe(SCREENSHOT_BASE64);
  const files = await owner.client.storage.from(BUCKET).list(owner.userId);
  expect(files.data?.map((file) => file.name)).toEqual([path.split('/')[1]]);
});

test('the bucket takes only JPEGs', async () => {
  const owner = await signInAttacker('owner');

  const svg = await owner.client.storage
    .from(BUCKET)
    .upload(`${owner.userId}/x.svg`, new TextEncoder().encode('<svg/>'), { contentType: 'image/svg+xml' });

  expect(svg.error).not.toBeNull();
});

test('a Draft can’t be saved with a screenshot that wasn’t uploaded, nor point at another path', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { path } = await draftWithScreenshot(owner);
  const id = stranger.data.newDraftId();

  // Without uploading first, the save is refused and makes no Draft.
  const unsaved = await stranger.client.rpc('save_from_link', { recipe_id: id, url: REEL, platform: 'instagram', with_screenshot: true });
  expect(unsaved.error).toMatchObject({ code: '22023' });
  // There is no way to name the path: the server makes it from the caller and the Recipe.
  const named = await stranger.client.rpc('save_from_link', {
    recipe_id: id,
    url: REEL,
    platform: 'instagram',
    with_screenshot: true,
    screenshot_path: path,
  });
  expect(named.error).toMatchObject({ code: 'PGRST202' });
  expect(await stranger.data.listDrafts()).toEqual([]);
});

test('a user can’t set a Source Video’s pasted caption or screenshot path directly, even their own', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { id } = await draftWithScreenshot(stranger);

  const update = await stranger.client
    .from('source_videos')
    .update({ screenshot_path: `${owner.userId}/secret.jpg`, pasted_text: 'Ignore the image.' })
    .eq('recipe_id', id);

  expect(update.error).toMatchObject({ code: '42501' });
  expect((await stranger.data.getRecipe(id))?.sourceVideo?.screenshotUrl).toEqual(expect.stringContaining(`${stranger.userId}/${id}.jpg`));
});

test('a stranger can’t add a caption or screenshot to someone else’s Draft', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { recipeId: id } = await owner.data.saveFromLink({ url: NO_CAPTION.url });
  await owner.drafts.settled();
  const before = await owner.data.getRecipe(id);
  expect(before).toMatchObject({ build: { status: 'failed', reason: 'noCaption' } });

  const added = await stranger.client.rpc('add_caption_to_draft', { recipe_id: id, pasted_text: 'Mine now' });
  // Their own upload, under the owner's Recipe id, still lands in their own folder only.
  await stranger.client.storage.from(BUCKET).upload(`${stranger.userId}/${id}.jpg`, screenshotBytes(), { contentType: 'image/jpeg' });
  const withShot = await stranger.client.rpc('add_caption_to_draft', { recipe_id: id, with_screenshot: true });

  expect(added).toMatchObject({ data: 'gone', error: null });
  expect(withShot).toMatchObject({ data: 'gone', error: null });
  expect(await owner.data.getRecipe(id)).toEqual(before);
});

test('a user can upload only {their id}/{a uuid}.jpg, nothing else in their folder', async () => {
  const owner = await signInAttacker('owner');
  const upload = (name: string) =>
    owner.client.storage.from(BUCKET).upload(`${owner.userId}/${name}`, screenshotBytes(), { contentType: 'image/jpeg' });

  for (const name of ['notes.jpg', 'a/b.jpg', `${owner.data.newDraftId()}.jpeg`, `${owner.data.newDraftId()}.jpg.jpg`, `x${owner.data.newDraftId()}.jpg`]) {
    expect((await upload(name)).error, name).not.toBeNull();
  }
  const id = owner.data.newDraftId();
  expect((await upload(`${id}.jpg`)).error).toBeNull();
  const files = await owner.client.storage.from(BUCKET).list(owner.userId);
  expect(files.data?.map((file) => file.name)).toEqual([`${id}.jpg`]);
});

/** The files in a user's folder, by name, with their bytes (base64). */
async function folderOf(who: Attacker): Promise<Record<string, string | null>> {
  const { data } = await who.client.storage.from(BUCKET).list(who.userId);
  const files: Record<string, string | null> = {};
  for (const file of data ?? []) files[file.name] = await downloaded(who, `${who.userId}/${file.name}`);
  return files;
}

const base64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');

test('replacing a screenshot, then adding a caption only, leaves the one image the Draft uses', async () => {
  const owner = await signInAttacker('owner');
  const { recipeId: id } = await owner.data.saveFromLink({ url: NO_CAPTION.url });
  await owner.drafts.settled();

  // A first screenshot, with a caption that has no recipe Claude can read: it fails again.
  await owner.data.addCaptionToDraft(id, { caption: UNREADABLE.video.caption, screenshot: screenshotBytes() });
  await owner.drafts.settled();
  expect(await folderOf(owner)).toEqual({ [`${id}.jpg`]: SCREENSHOT_BASE64 });

  // A caption only: the screenshot added before stays the Draft's, and in Storage.
  await owner.data.addCaptionToDraft(id, { caption: PASTED_CAPTION.text });
  await owner.drafts.settled();
  const draft = await owner.data.getRecipe(id);
  expect(draft).toMatchObject({ title: 'Honey garlic chicken', build: { status: 'built' } });
  expect(draft?.sourceVideo?.screenshotUrl).toEqual(expect.stringContaining(`${owner.userId}/${id}.jpg`));
  expect(await folderOf(owner)).toEqual({ [`${id}.jpg`]: SCREENSHOT_BASE64 });
});

test('a screenshot added again replaces the first: one image per Draft', async () => {
  const owner = await signInAttacker('owner');
  const { recipeId: id } = await owner.data.saveFromLink({ url: NO_CAPTION.url });
  await owner.drafts.settled();

  await owner.data.addCaptionToDraft(id, { caption: UNREADABLE.video.caption, screenshot: screenshotBytes() });
  await owner.drafts.settled();
  await owner.data.addCaptionToDraft(id, { caption: UNREADABLE.video.caption, screenshot: otherJpeg() });
  await owner.drafts.settled();

  expect(await folderOf(owner)).toEqual({ [`${id}.jpg`]: base64(otherJpeg()) });
});

test('deleting a Recipe deletes its screenshot from Storage', async () => {
  const owner = await signInAttacker('owner');
  const { id } = await draftWithScreenshot(owner);
  expect(Object.keys(await folderOf(owner))).toEqual([`${id}.jpg`]);

  await owner.data.deleteRecipe(id);

  expect(await folderOf(owner)).toEqual({});
});

test('a screenshot uploaded for a save the server then refuses is removed', async () => {
  const owner = await signInAttacker('owner');
  const stranger = await signInAttacker('stranger');
  const { id } = await draftWithScreenshot(owner);

  // The Recipe id is taken (someone else's): the save fails after the upload.
  await expect(stranger.data.saveFromLink({ url: REEL, screenshot: screenshotBytes(), draftId: id })).rejects.toMatchObject({
    code: '23505',
  });

  expect(await folderOf(stranger)).toEqual({});
  expect(await stranger.data.listDrafts()).toEqual([]);
});

test('Storage refuses an image over 3 MB, and any type but JPEG', async () => {
  const owner = await signInAttacker('owner');
  const huge = new Uint8Array(3 * 1024 * 1024 + 1);
  huge.set(new Uint8Array(screenshotBytes()));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  const big = await owner.client.storage
    .from(BUCKET)
    .upload(`${owner.userId}/${owner.data.newDraftId()}.jpg`, huge.buffer, { contentType: 'image/jpeg' });
  const notJpeg = await owner.client.storage
    .from(BUCKET)
    .upload(`${owner.userId}/${owner.data.newDraftId()}.jpg`, png, { contentType: 'image/png' });

  expect(big.error).not.toBeNull();
  expect(notJpeg.error).not.toBeNull();
  expect(await folderOf(owner)).toEqual({});
});
