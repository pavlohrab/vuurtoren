# Sync your devices

Sync keeps your words, texts, reviews and progress the same on all your devices. Each device
keeps a full copy; the sync place only passes changes between them.

## Is it safe?

Yes. Before anything leaves your device, Vuurtoren locks it with your **passphrase**. The sync
place only sees locked files and cannot read them.

You also get a **recovery key**. Keep it somewhere safe: it opens your data if you forget the
passphrase.

## Where your data can sync through

All your devices use the same place.

| Place                     | Devices                | Good for                               |
| ------------------------- | ---------------------- | -------------------------------------- |
| Your own Vuurtoren server | computer and phone     | You [self-host](self-host.md) a server |
| WebDAV                    | computer and phone     | Nextcloud, ownCloud, a NAS             |
| A folder you already sync | computer (desktop app) | Syncthing, Dropbox, iCloud Drive       |

**Vuurtoren Sync** (sync.vuurtoren.app) is planned: sign in, and your devices sync without
setting anything up.

## Set it up

In the app: **Settings → Your devices**.

**The first device** (a computer or a phone, never the server):

1. Choose the place and fill in its details (see below).
2. Choose **Start new sync data here** and type a passphrase: a few words you will remember.
3. Save the **recovery key** it shows.

**Every other device:**

1. Choose the same place.
2. Choose **Join my synced data** and type the same passphrase. Your data downloads.

## Your own server

- **Connect manually:** type the server's address, its user name and password. The device gets
  its own access; the password is not kept.
- **Or with a code:** open the server's address in a browser, sign in, and press **Add a device**.
  On a phone, scan the QR code. On a computer, paste the link under it. The code works once, for
  10 minutes, and never holds your passphrase.
- Remove a device on the server's **Your devices** page.

A phone that syncs with your server also uses it as its language server, to analyse texts you add
on the phone. The desktop app has its own.

## WebDAV (Nextcloud)

1. In Nextcloud Files, make a folder named `Vuurtoren`.
2. Copy the WebDAV address from Files → Files settings, and add `/Vuurtoren` to it.
3. Make an app password: Settings → Security → Devices & sessions → Create new app password.
4. In Vuurtoren, choose WebDAV and give the address, your user name and the app password.

## A synced folder (Syncthing)

1. Make a folder, for example `~/Sync/Vuurtoren`, and share it in Syncthing with your other
   computers.
2. In Vuurtoren on each computer, choose **A folder you already sync** and pick it. Do not pick
   the folder where Vuurtoren keeps its own data.

Phones cannot share a folder this way: use your server or WebDAV there.

## When two devices change the same thing

Every change is saved with a time from a hybrid clock (the device's time and a counter, so the
order holds even when clocks differ). Each device replays all changes in that order and ends up
with the same result:

- **Settings, word marks, your profile:** the latest change wins.
- **Reviews and answers:** none is lost. Both count, each applied to the card as it is when it
  arrives.
- **Added words and texts:** both are kept. The same word added on two devices is one word.

## How fast

While Vuurtoren is open on two devices, a change on one shows on the other within about 5 to 20
seconds. It syncs when it opens, a few seconds after a change, every 15 seconds and when you
come back to it, and sends what is left when you close it.

## Good to know

- **Change your passphrase** in Settings → Your devices. Your other devices keep syncing.
- **Lost your passphrase?** Type the recovery key where Vuurtoren asks for the passphrase.
- **Stop syncing** on one device in Settings → Your devices. Its data stays.
- **Lost a device?** Remove it on your server's page. To be safe, start new sync data with a new
  passphrase and join it from your other devices.
- Keep a backup now and then: Settings → **Data & backup → Download backup**.
