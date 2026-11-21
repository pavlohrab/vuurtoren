# Sync your devices

Sync keeps your words, texts, reviews and progress the same on all your devices.

## Is it safe?

Yes. Before anything leaves your device, Vuurtoren locks it with your **passphrase**. The place
where your data is stored only sees locked files. It cannot read them.

You also get a **recovery key**. Keep it somewhere safe. If you forget your passphrase, the
recovery key opens your data.

## Where your data can sync through

Choose one place. All your devices use the same place.

| Place                     | Good for                                        |
| ------------------------- | ----------------------------------------------- |
| Your own Vuurtoren server | You [self-host](self-host.md) Vuurtoren; phones |
| A folder you already sync | Syncthing, Dropbox, iCloud Drive (desktop app)  |
| WebDAV                    | Nextcloud, ownCloud, a NAS (desktop app)        |

**Vuurtoren Cloud** is coming: sync without setting anything up.

## Set it up

On the **first device**:

1. Open **Settings → Sync**.
2. Choose the place and fill in its details (see below).
3. Choose **Start new sync data here**.
4. Type a passphrase: a few words that you will remember.
5. Click **Start syncing**.
6. Save the **recovery key** that Vuurtoren shows you, then click **I have saved it**.

On **every other device**:

1. Open **Settings → Sync** and choose the same place.
2. Choose **Join my synced data**.
3. Type the same passphrase and click **Join and sync**.

## How fast

While Vuurtoren is open on two devices, a change on one shows on the other within about 5 to
20 seconds:

- Vuurtoren syncs when it opens.
- It sends your changes a few seconds after you stop making them.
- It looks for changes from your other devices every 15 seconds, and when you come back to it.
- It sends what is left when you close it.

During a practice session it waits until the session ends, so nothing changes under your hands.

## Add a phone

1. On your computer, open your Vuurtoren server in a browser and sign in.
2. Go to **Settings → Sync → Add a phone** and click **Show a QR code**.
3. On the phone, open Vuurtoren. On the first start, tap **Connect to your server** (later:
   **Settings → Sync → Connect to your server**).
4. Tap **Scan the QR code** and point the camera at the code. Vuurtoren asks once whether it may
   send your sync files to the server: tap **Allow**.
5. Type your **passphrase** and tap **Join and sync**.

The phone gets its own sync token and keeps it in its key store. It appears in the server's list
of sync tokens as "Phone (your phone's model)", where you can revoke it. The same server is also
the phone's language server, for adding new texts.

The QR code holds the server's address and a **pairing code**. The code works once, for 10
minutes; a new one appears when it expires. Your passphrase is never in the code, so a photo of
it cannot open your data.

No camera? Copy the link under the QR code (`vuurtoren://connect?…`) and paste it under
**Connect to your server**, or type the server's address and the pairing code. This works on a
computer too.

## Details for each place

**Your own Vuurtoren server**

- In a browser on that server: choose **This server**. Nothing else to fill in.
- On a phone (or any other device): see **Add a phone** above.
- Or make a token yourself: open the server in a browser, go to **Settings → Sync** and click
  **Make a sync token**. Make one token for each device. On the device, give the server address
  and that token.

A device that syncs with your server also uses its language server, unless it has its own (the
desktop app does).

**A folder you already sync** (desktop app)

Click **Choose a folder** and pick a folder that Syncthing, Dropbox or iCloud Drive already
syncs. Do not pick the folder where Vuurtoren keeps its own data.

**WebDAV** (desktop app)

Give the WebDAV address, your user name and an **app password** (not your main password). In
Nextcloud you find the address under **Files → Settings → WebDAV**.

## Good to know

- **Change your passphrase** in Settings → Sync. Your other devices keep syncing.
- **Lost your passphrase?** Use the recovery key where Vuurtoren asks for the passphrase.
- **A device forgot its key** (for example after a system update): Settings → Sync asks for the
  passphrase. Type it and sync goes on.
- **Files that do not sync** are listed in Settings → Sync.
- **Stop syncing** on one device in Settings → Sync. The data on that device stays.
- **Lost a device?** On a Vuurtoren server, revoke its sync token first. The device still holds
  the key to your data, so to be safe start new sync data in a new place: on one device choose
  **Stop syncing**, then **Start new sync data here** with a new passphrase in a new folder or
  WebDAV address (on your server: after you remove the `sync` folder on its data volume). Then
  join it from your other devices.
- Keep a backup now and then: Settings → **Data & backup → Download backup**.
