# How Vuurtoren works

Vuurtoren keeps track of the words you know, and plans each page you read around them. None of it
uses AI, and all of it runs on your computer. This page is the short version. The full story, with the
rules and the numbers, is in [the developer docs](dev/algorithms.md).

## It knows which words you know

For every word Vuurtoren keeps the chance that you remember it right now. Every review changes that
number, with FSRS, the algorithm Anki also offers, and your Anki decks count too. With Vuurtoren's
own cards reading counts as well: a word you read without looking it up waits a little longer for
its next review, and a word you had to look up comes back today.

## Just enough help on every page

Before you read a page of about 150 words, Vuurtoren plans it. It picks about three new words for
you to learn, from the most common words you don't know yet, preferably ones that come back later in
the text, and leaves them untranslated. You can tap any other word to see what it means, and in
Gloss mode the words you may not know get their English above them. When reading goes well, the
next pages get a few more new words, and when you look up a lot, they get fewer.

This follows reading research. You can follow a text when you know about 95% of its words, and read
it comfortably at 98% (Laufer & Ravenhorst-Kalovski 2010; Schmitt, Jiang & Grabe 2011), and a new
word needs about ten meetings before it sticks (Webb 2007). The sources, with links, are on the
[How it works](https://vuurtoren.app/how.html) page of the website.

## It runs on your computer

To find the words and the grammar of a text, Vuurtoren uses spaCy, a language analysis tool, and a
small translation model, OPUS-MT. How each sentence is built comes from SyntaxDot on a server, and on
Linux when you download it, and from spaCy elsewhere. The meanings and example sentences come from open dictionaries
(Wiktionary, Tatoeba and wordfreq). All of it is on your computer, so it works offline and your
texts stay with you.

## Where AI comes in

Only if you add your own AI key. Then it can explain a sentence, write a story at your level or talk
with you, and Vuurtoren checks what it writes against your words. See [Add your AI](ai.md).
