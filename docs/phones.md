# Vuurtoren on your phone

The phone app is the same app as on your computer. It keeps its own copy of your data and works
offline. The one thing it can't do by itself is prepare a new text, because that needs the language
server, and that only runs on a computer or a server. So your computer does it for the phone, or
your own server does, and later Vuurtoren Sync will too.

## What works where

| What                                               | Phone alone | Phone + a language server |
| -------------------------------------------------- | :---------: | :-----------------------: |
| Words: reviews, new words, about 5000 common words |      ✓      |             ✓             |
| Stories, with side by side and grammar marks       |      ✓      |             ✓             |
| Grammar lessons                                    |      ✓      |             ✓             |
| A word's meaning from the dictionary               |      ✓      |             ✓             |
| Texts you added on your computer, fully            |      ✓      |             ✓             |
| Recorded words, sentences and stories              |  download   |             ✓             |
| Adding a new text on the phone (paste, photo)      |             |             ✓             |
| Sync with your other devices                       |   WebDAV    |             ✓             |

"Fully" means with the meaning of each word in its sentence, the translation of each sentence,
side by side and the grammar marks.

**The recordings** of the common words, their sentences and the stories are a download on the
phone, about 230 MB. The app asks once when you first open it, and you can get them later in
Settings → Reading. Until it's done, and for words that were never recorded,
the phone reads with its own Dutch voice. **Test the voice** plays one word and tells you which
voice it was.

**How the computer helps the phone.** When the desktop app reads a new text, it also prepares
everything the phone needs for it, and sync brings it over with the text. So add a text on your
computer, and read it on your phone, even on a train. This works with every way to sync.

**A text you add on the phone** needs a language server. Without one, it waits: open Vuurtoren
on your computer, and after the next sync the text is ready on your phone too.

## Connect it to your computer

On the computer, open Settings → Your devices → **Connect a phone** and press **Show the code**.
On the phone, scan it (in Settings → Your devices, or when you first open the app). Both need to be
on the same Wi-Fi. If the camera doesn't work, type the address and the code the computer shows.
The computer asks "Is this your phone?" before anything goes over, and you say yes.

After that the phone syncs with your computer whenever both are home, and away from home it reads
what it has. A phone connected like this has no **Add text**: you add texts on the computer, and
the phone gets them ready to read.

If it stops syncing at home, your computer may have a new address. Show the code again and scan it,
and the phone stays connected. Want the phone to sync from anywhere? Use WebDAV or your own server
instead.

## Install

Android: download the `.apk` from the [latest release](https://github.com/pavlohrab/Vuurtoren/releases/latest)
and open it. Your phone asks to allow installs from your browser once.

iPhone: not yet.

## Other ways to connect it

The phone can also sync through WebDAV or your own server, in Settings → Your devices. How that
works is on [Sync your devices](guide/sync.md).

Deleting the app deletes its data on the phone. When you install it again it starts fresh, and your
data comes back through sync or from a backup file (Settings → Data).
