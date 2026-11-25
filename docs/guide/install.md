# Install Vuurtoren

## On your computer

Go to the [latest release](https://github.com/pavlohrab/Vuurtoren/releases/latest) and download the
file for your computer. On Windows it's the `.exe`, on a Mac the `.dmg` (there is one for the new
Macs with an Apple chip and one for the older Intel Macs), and on Linux the `.AppImage` or the
`.deb`. Then open the file and install Vuurtoren like any other app.

The app is not signed yet, so your computer may warn you the first time. On Windows, click
**More info** and then **Run anyway**. On a Mac, close the warning, go to **System Settings →
Privacy & Security** and click **Open Anyway**. On Linux, make the AppImage executable
(`chmod +x Vuurtoren*.AppImage`) and run it.

When Vuurtoren starts for the first time, it downloads its language data, about 390 MB. That's the
dictionary, the example sentences, the translation model, the recordings and a Dutch voice for
computers that don't have one. If that computer has no internet, take the installer whose name
starts with `Vuurtoren_offline_` instead, because it has all of this inside.

On a computer the app works out how each sentence is built with spaCy. A Vuurtoren server does it
better, with SyntaxDot. On Linux you can add SyntaxDot to the app yourself (about 850 MB), and the
app uses it from its next start:

```sh
d=~/.local/share/app.vuurtoren.desktop/nlp-data/syntaxdot && mkdir -p "$d" && cd "$d"
curl -L https://github.com/tensordot/syntaxdot/releases/download/v0.5.0/syntaxdot-v0.5.0-cpu-x86_64-linux-gnu-gcc.tar.zst | tar --zstd -x
curl -L https://github.com/tensordot/syntaxdot-models/releases/download/nl-l6-h384-20210728/nl-l6-h384-20210728.tar.gz | tar -xz
mv syntaxdot-v0.5.0-cpu-x86_64-linux-gnu-gcc bin && mv nl-l6-h384-20210728 nl
```

## On your phone

Vuurtoren works on Android. Download `Vuurtoren-android.apk` from the
[latest release](https://github.com/pavlohrab/Vuurtoren/releases/latest) on your phone and open it.
Android asks once if your browser may install apps, so allow it. What the phone can do on its own,
and what it needs your computer for, is on [On your phone](../phones.md).

## The first start

Vuurtoren first asks: **Do you use Anki?**

If you say **no**, Vuurtoren keeps your words and your reviews itself, and you don't need anything
else. It asks where new words should start (from the most common words, or a bit further if you
already know some Dutch), and then it opens with a story at your level.

If you say **yes**, you can move your decks into Vuurtoren with their review history, or keep using
Anki and read here. To keep using Anki, keep Anki open with the
[AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on (code `2055492159`). This works
on a computer only for now.

On a phone, Vuurtoren also asks if you have your own server. You can say "Not now" and add it
later.

After that, add a text of your own whenever you like: paste it, give a web address, or choose a
PDF or a photo.

## Use it on more devices

To have your words on every device, see [Sync](sync.md). If you want your own server, for sync and
for preparing texts on the phone, see [Self-host](self-host.md).
