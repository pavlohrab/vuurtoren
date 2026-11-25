# Sync your devices

Sync keeps your words, texts, reviews and progress the same on all your devices. Every device keeps
its own full copy, and the sync place only passes the changes between them.

## Is it safe?

Yes. Before anything leaves your device, Vuurtoren locks it with your **passphrase**, so the sync
place only ever sees locked files that it can't read. When you set up sync, you also get a
**recovery key**. Keep it somewhere safe, because it opens your data if you forget the passphrase.

## Where your data can sync through

All your devices have to use the same place. There are three options for now.

| Place                     | Devices                | Good for                               |
| ------------------------- | ---------------------- | -------------------------------------- |
| Your own Vuurtoren server | computer and phone     | You [self-host](self-host.md) a server |
| WebDAV                    | computer and phone     | Nextcloud, ownCloud, a NAS             |
| A folder you already sync | computer (desktop app) | Syncthing, Dropbox, iCloud Drive       |

**Vuurtoren Sync** (sync.vuurtoren.app) is planned. Then you'll just sign in, and your devices sync
without setting anything up.

## Set it up

Everything happens in **Settings → Your devices**.

On your **first device**, which is a computer or a phone (never the server):

1. Choose the place and fill in its details (see below).
2. Choose **Start new sync data here** and type a passphrase. A few words you'll remember work
   well.
3. Save the **recovery key** it shows you.

On **every other device**:

1. Choose the same place.
2. Choose **Join my synced data** and type the same passphrase. Your data then downloads.

## Your own server

You can connect a device by typing the server's address, your user name and your password. The
device gets its own access, and the password itself is not kept.

It's easier with a code. Open the server's address in a browser, sign in and press **Add a
device**. On a phone you scan the QR code, and on a computer you paste the link under it. The code
works once, for 10 minutes, and it never holds your passphrase. You can remove a device again on
the server's **Your devices** page.

A phone that syncs with your server also uses it as its language server, so it can prepare the
texts you add on the phone. The desktop app doesn't need that, because it has its own.

## WebDAV (Nextcloud)

1. In Nextcloud Files, make a folder called `Vuurtoren`.
2. Copy the WebDAV address from Files → Files settings, and add `/Vuurtoren` at the end.
3. Make an app password in Settings → Security → Devices & sessions → Create new app password.
4. In Vuurtoren, choose WebDAV and fill in the address, your user name and the app password.

## A synced folder (Syncthing)

1. Make a folder, for example `~/Sync/Vuurtoren`, and share it in Syncthing with your other
   computers.
2. In Vuurtoren on each computer, choose **A folder you already sync** and pick that folder. Don't
   pick the folder where Vuurtoren keeps its own data.

Phones can't share a folder like this, so on a phone use your server or WebDAV.

## When two devices change the same thing

Every change is saved with a time, and every device puts all the changes in the same order, so in
the end they all show the same thing. For settings, word marks and your profile, the latest change
wins. Reviews and answers are never lost: if you review on two devices, both count. Words and texts
added on two devices are both kept, and the same word added twice is one word.

## How fast

While Vuurtoren is open on two devices, a change on one shows up on the other within about 20
seconds, often sooner. It also syncs when you open it or come back to it, and it sends what's left
when you close it.

## Good to know

You can change your passphrase in Settings → Your devices, and your other devices keep syncing. If
you lose your passphrase, type the recovery key where Vuurtoren asks for the passphrase. To stop
syncing on one device, use Settings → Your devices; its data stays on it.

If you lose a device, remove it on your server's page. To be safe, start new sync data with a new
passphrase and join it again from your other devices.

When your phone connects to your computer at home (Settings → Your devices → Connect a phone), the
computer listens on port 47120. If a firewall on the computer blocks it, the phone can't reach it,
so allow that port. Windows asks the first time: say yes for private networks. On Linux with
firewalld it's:

```sh
sudo firewall-cmd --permanent --add-port=47120/tcp && sudo firewall-cmd --reload
```

And keep a backup now and then, in Settings → **Data → Download backup**.
