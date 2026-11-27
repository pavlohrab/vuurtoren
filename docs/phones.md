# Vuurtoren on your phone

The phone app is the same app as on your computer. It keeps its own copy of your words and texts
and works without internet.

There is one thing a phone can't do by itself: prepare a new text. Preparing means finding out what
every word is and what it means in its sentence, and that needs the language server, a program that
runs on your computer or on a server. So you add new texts on your computer, and the phone gets
them ready to read when it syncs.

## What works where

| What                                  | Phone alone | Phone with your computer or a server |
| ------------------------------------- | :---------: | :----------------------------------: |
| Your words: reviews, new words        |      ✓      |                  ✓                   |
| The 35 stories                        |      ✓      |                  ✓                   |
| Grammar lessons                       |      ✓      |                  ✓                   |
| Texts you added on your computer      |      ✓      |                  ✓                   |
| Recorded words, sentences and stories |  download   |                  ✓                   |
| Adding a new text on the phone        |             |                  ✓                   |
| Sync with your other devices          |   WebDAV    |                  ✓                   |

**The recordings** are a download of about 230 MB. The app asks once when you first open it, and you
can get them later in **Settings → Reading**. Until then the phone reads with its own Dutch voice.

## Connect it to your computer

1. On the computer, open **Settings → Your devices → Connect a phone** and press **Show the QR
   code**.
2. On the phone, scan the code, in **Settings → Your devices** or when you first open the app. Both
   need to be on the same Wi-Fi. If the camera doesn't work, type the address and the code the
   computer shows.
3. The computer asks "Is this your phone?". Say yes.

From then on the phone syncs with your computer when both are at home. Away from home it reads what
it already has.

If it stops syncing at home, your computer may have a new address on the Wi-Fi. Show the QR code
again and scan it. To sync from anywhere, use WebDAV or your own server instead, see
[Sync your devices](guide/sync.md).

## Install

Android: download the `.apk` from the
[latest release](https://github.com/pavlohrab/Vuurtoren/releases/latest) and open it. Your phone
asks once if your browser may install apps.

iPhone: not yet.

Deleting the app deletes its data on the phone. If you install it again, your data comes back
through sync or from a backup file (**Settings → Data**).
