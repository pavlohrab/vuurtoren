# Sync your devices

Sync keeps your words, texts, reviews and progress the same on all your devices.

## Is it safe?

Yes. Before anything leaves your device, Vuurtoren locks it with your **passphrase**. The place
where your data is stored only sees locked files. It cannot read them.

You also get a **recovery key**. Keep it somewhere safe. If you forget your passphrase, the
recovery key opens your data.

## Where your data can sync through

Choose one place. All your devices use the same place.

| Place                       | Good for                                       |
| --------------------------- | ---------------------------------------------- |
| Your own Vuurtoren server   | You [self-host](self-host.md) Vuurtoren        |
| A folder you already sync   | Syncthing, Dropbox, iCloud Drive (desktop app) |
| WebDAV                      | Nextcloud, ownCloud, a NAS                     |
| A private GitHub repository | You already use GitHub                         |

**Vuurtoren Cloud** is coming: sync without setting anything up.

## Set it up

On the **first device**:

1. Open **Settings → Sync**.
2. Choose the place and fill in its details (see below).
3. Choose **Start new sync data here**.
4. Type a passphrase: a few words that you will remember.
5. Click **Start syncing**.
6. Save the **recovery key** that Vuurtoren shows you.

On **every other device**:

1. Open **Settings → Sync** and choose the same place.
2. Choose **Join my synced data**.
3. Type the same passphrase and click **Join and sync**.

After that, Vuurtoren syncs by itself while it is open, and when you close it.

## Details for each place

**Your own Vuurtoren server**

1. Open your server in a browser and go to **Settings → Sync**.
2. Click **Make a sync token**. Make one token for each device.
3. On the device, give the server address and that token.

**A folder you already sync** (desktop app)

Click **Choose a folder** and pick a folder that Syncthing, Dropbox or iCloud Drive already
syncs. Do not pick the folder where Vuurtoren keeps its own data.

**WebDAV**

Give the WebDAV address, your user name and an **app password** (not your main password). In
Nextcloud you find the address under **Files → Settings → WebDAV**.

**A private GitHub repository**

1. Make an empty **private** repository.
2. Make a fine-grained token that may read and write only that repository's contents.
3. Give `you/repository-name` and the token.

## Good to know

- **Change your passphrase** in Settings → Sync. Your other devices keep syncing.
- **Lost your passphrase?** Use the recovery key where Vuurtoren asks for the passphrase.
- **Stop syncing** on one device in Settings → Sync. The data on that device stays.
- Keep a backup now and then: Settings → **Data & backup → Download backup**.
