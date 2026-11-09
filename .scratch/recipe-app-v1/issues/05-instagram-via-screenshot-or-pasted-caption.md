# 05: Instagram via screenshot or pasted caption

**What to build:** When a user shares an Instagram Reel, the save screen offers "Add screenshot" and "Paste caption", because Instagram offers no allowed way to read a Reel (ADR-0004). The Draft builder reads the screenshot (through Haiku's image input) or the pasted text, and follows any recipe-site link in it. The Recipe shows a plain Instagram card linking to the Reel, or the user's screenshot as its picture. The app never makes a network call to Instagram.

**Blocked by:** 03 (Save a TikTok link into a Draft).

**Status:** done

- [ ] The share extension accepts an Instagram link together with an image or text
  - Text with the link in it works (it arrives as the caption), and the app reads a shared image as the screenshot. But expo-share-intent 9's iOS extension keeps only the last attachment's kind (`ShareExtensionViewController.swift`: text, web URL or media, never two), so a link and an image shared together reach the app as one of them. Combining them needs a patch to the extension and a new dev build; not done.
- [x] The save screen for Instagram links offers "Add screenshot" and "Paste caption"; saving with neither still works and gives a recipe-not-in-caption Draft
- [x] A screenshot is stored as the user's own image and read by the Draft builder
- [x] Pasted caption text is read by the Draft builder, including following a recipe-site link in it
- [x] The Recipe shows an Instagram card or the screenshot, and tapping it opens the Reel
- [x] No code path fetches instagram.com or any Meta endpoint
- [x] Data-layer tests with fakes cover: screenshot input → Draft; pasted text → Draft; neither → recipe-not-in-caption Draft
