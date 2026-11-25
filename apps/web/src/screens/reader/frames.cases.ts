/**
 * The sentence-structure test set (F3, notes/wc6-sentence-structures.md): Dutch sentences of
 * every kind, each with its clauses written by hand. The tokens (from the real language server)
 * are in frames.fixture.json, made by `scripts/frames-fixture.mjs`.
 *
 * Each clause is a kind and its parts, joined by "|", punctuation left out:
 * - main, question, command: first | verb | middle | verb end | rest
 * - sub (omdat, als, dat, of, wie …) and rel (die, dat, waar…): introducer | middle | verbs | rest
 * A clause inside another shows as "[…]" in the part of the outer clause it sits in. A second
 * joining word (en, maar, want, dus) shows as "(Maar) " before the clause. Clauses in reading
 * order.
 */
export interface FrameCase {
  sentence: string;
  /** What kind of sentence it tests. */
  about: string;
  clauses: string[];
  /** Why the code can't get it yet (the test skips it and says so). */
  hard?: string;
}

export const FRAME_CASES: FrameCase[] = [
  { sentence: "Ik werk morgen.", about: "main", clauses: ["main: Ik|werk|morgen||"] },
  { sentence: "Morgen werk ik.", about: "inversion", clauses: ["main: Morgen|werk|ik||"] },
  {
    sentence: "Ik heb gisteren hard gewerkt.",
    about: "verb end",
    clauses: ["main: Ik|heb|gisteren hard|gewerkt|"],
  },
  {
    sentence: "Ik wil morgen werken.",
    about: "verb end",
    clauses: ["main: Ik|wil|morgen|werken|"],
  },
  {
    sentence: "Ik bel je morgen op.",
    about: "split verb",
    clauses: ["main: Ik|bel|je morgen|op|"],
  },
  {
    sentence: "Ik probeer te slapen.",
    about: "verb end",
    clauses: ["main: Ik|probeer||te slapen|"],
  },
  {
    sentence: "Hij is naar huis gegaan.",
    about: "verb end",
    clauses: ["main: Hij|is|naar huis|gegaan|"],
  },
  {
    sentence: "Zij moet morgen vroeg opstaan.",
    about: "verb end",
    clauses: ["main: Zij|moet|morgen vroeg|opstaan|"],
  },
  {
    sentence: "Ik heb hem zien lopen.",
    about: "verb end",
    clauses: ["main: Ik|heb|hem|zien lopen|"],
  },
  { sentence: "Dat wist ik niet.", about: "inversion", clauses: ["main: Dat|wist|ik niet||"] },
  { sentence: "Waar woon je?", about: "question", clauses: ["question: Waar|woon|je||"] },
  { sentence: "Woon je hier?", about: "question", clauses: ["question: |Woon|je hier||"] },
  {
    sentence: "Kun je me helpen?",
    about: "question",
    clauses: ["question: |Kun|je me|helpen|"],
  },
  {
    sentence: "Wat heb je gisteren gedaan?",
    about: "question",
    clauses: ["question: Wat|heb|je gisteren|gedaan|"],
  },
  { sentence: "Kijk!", about: "command", clauses: ["command: |Kijk|||"] },
  {
    sentence: "Doe de deur dicht.",
    about: "command",
    clauses: ["command: |Doe|de deur|dicht|"],
  },
  {
    sentence: "Ik blijf thuis, omdat ik moe ben.",
    about: "sub after",
    clauses: ["main: Ik|blijf||thuis|[…]", "sub: omdat|ik moe|ben|"],
  },
  {
    sentence: "Als het regent, blijf ik thuis.",
    about: "sub first",
    clauses: ["main: […]|blijf|ik|thuis|", "sub: Als|het|regent|"],
  },
  {
    sentence: "Omdat het koud was, bleven we binnen.",
    about: "sub first",
    clauses: ["main: […]|bleven|we|binnen|", "sub: Omdat|het koud|was|"],
  },
  {
    sentence: "Toen ik thuiskwam, was het donker.",
    about: "sub first",
    clauses: ["main: […]|was|het donker||", "sub: Toen|ik|thuiskwam|"],
  },
  {
    sentence: "Als ze boven is, is ze dood.",
    about: "sub first",
    clauses: ["main: […]|is|ze dood||", "sub: Als|ze boven|is|"],
  },
  {
    sentence: "Wie het weet, mag het zeggen.",
    about: "sub first",
    clauses: ["main: […]|mag|het|zeggen|", "sub: Wie|het|weet|"],
  },
  {
    sentence: "Ik weet dat hij komt.",
    about: "dat-clause",
    clauses: ["main: Ik|weet|||[…]", "sub: dat|hij|komt|"],
  },
  {
    sentence: "Hij zegt dat hij morgen komt.",
    about: "dat-clause",
    clauses: ["main: Hij|zegt|||[…]", "sub: dat|hij morgen|komt|"],
  },
  {
    sentence: "Ik denk dat het gaat regenen.",
    about: "dat-clause",
    clauses: ["main: Ik|denk|||[…]", "sub: dat|het|gaat regenen|"],
  },
  {
    sentence: "Hij vroeg of ik mee wilde.",
    about: "of-clause",
    clauses: ["main: Hij|vroeg|||[…]", "sub: of|ik mee|wilde|"],
  },
  {
    sentence: "Ik weet niet waarom hij boos is.",
    about: "question word clause",
    clauses: ["main: Ik|weet|niet||[…]", "sub: waarom|hij boos|is|"],
  },
  {
    sentence: "De man die daar staat, is mijn vader.",
    about: "relative",
    clauses: ["main: De man […]|is|mijn vader||", "rel: die|daar|staat|"],
  },
  {
    sentence: "Het boek dat ik lees, is mooi.",
    about: "relative",
    clauses: ["main: Het boek […]|is|mooi||", "rel: dat|ik|lees|"],
  },
  {
    sentence: "De stad waar ik woon, is klein.",
    about: "relative",
    clauses: ["main: De stad […]|is|klein||", "rel: waar|ik|woon|"],
  },
  {
    sentence: "Ik ken de vrouw met wie je praat.",
    about: "relative",
    clauses: ["main: Ik|ken|de vrouw […]||", "rel: met wie|je|praat|"],
  },
  {
    sentence: "Ik heb het boek gelezen dat je me gaf.",
    about: "relative after the verb end",
    clauses: ["main: Ik|heb|het boek|gelezen|[…]", "rel: dat|je me|gaf|"],
    hard: "after the verb end, a relative dat and the conjunction dat look the same; the parse says ccomp",
  },
  {
    sentence: "Ik lees en zij schrijft.",
    about: "two main clauses",
    clauses: ["main: Ik|lees|||", "main: (en) zij|schrijft|||"],
  },
  {
    sentence: "Ze lachte, want het was grappig.",
    about: "two main clauses",
    clauses: ["main: Ze|lachte|||", "main: (want) het|was|grappig||"],
  },
  {
    sentence: "Hij is ziek, dus hij blijft thuis.",
    about: "two main clauses",
    clauses: ["main: Hij|is|ziek||", "main: (dus) hij|blijft|thuis||"],
  },
  { sentence: "Maar ze eet niet.", about: "linking word", clauses: ["main: (Maar) ze|eet|niet||"] },
  {
    sentence: '"Goed," zegt de man.',
    about: "quoted speech",
    clauses: ["main: Goed|zegt|de man||"],
  },
  {
    sentence: '"Nou ja," zegt de burgemeester dan.',
    about: "quoted speech",
    clauses: ["main: Nou ja|zegt|de burgemeester dan||"],
  },
  {
    sentence: '"En de rest?" vraagt Mila.',
    about: "quoted speech",
    clauses: ["main: En de rest|vraagt|Mila||"],
  },
  {
    sentence: '"Ik weet het," zegt hij.',
    about: "quote with its own verb",
    clauses: ["main: […]|zegt|hij||", "main: Ik|weet|het||"],
  },
  {
    sentence: '"Ben jij Hans?" vraagt hij.',
    about: "quoted question",
    clauses: ["main: […]|vraagt|hij||", "question: |Ben|jij Hans||"],
  },
  {
    sentence: '"Ga naar zee," zei ze.',
    about: "quoted command",
    clauses: ["main: […]|zei|ze||", "command: |Ga|naar zee||"],
  },
  {
    sentence: "Het is mij gelukt om binnen te komen.",
    about: "om … te",
    clauses: ["main: Het|is|mij|gelukt|[…]", "sub: om|binnen|te komen|"],
  },
  {
    sentence: "Sami leerde het Arabisch om de Koran beter te begrijpen.",
    about: "om … te",
    clauses: ["main: Sami|leerde|het Arabisch||[…]", "sub: om|de Koran beter|te begrijpen|"],
  },
  {
    sentence: "Kinderen gooiden steentjes naar haar, om te zien of ze zou bewegen.",
    about: "om … te with a clause inside",
    clauses: [
      "main: Kinderen|gooiden|steentjes naar haar||[…]",
      "sub: om||te zien|[…]",
      "sub: of|ze|zou bewegen|",
    ],
  },
  {
    sentence: "We hebben hem op heterdaad betrapt.",
    about: "participle the parser calls an adjective",
    clauses: ["main: We|hebben|hem op heterdaad|betrapt|"],
  },
  {
    sentence: "De moedige brandweerman redde een jongen uit het brandende huis.",
    about: "an -ende form before a noun is no verb end",
    clauses: ["main: De moedige brandweerman|redde|een jongen uit het brandende huis||"],
  },
  {
    sentence: "Ze hebben geen eten en geen water.",
    about: "a noun after geen is no verb",
    clauses: ["main: Ze|hebben|geen eten en geen water||"],
  },
  {
    sentence:
      "Ze praten een uur, over haar opa, over vroeger, over dingen die ze nog nooit hebben besproken.",
    about: "plural present in a relative clause",
    clauses: [
      "main: Ze|praten|een uur over haar opa over vroeger over dingen […]||",
      "rel: die|ze nog nooit|hebben besproken|",
    ],
  },
  {
    sentence: "Maar Jesse wil in de stad wonen, niet in de trein.",
    about: "an infinitive is the verb end, not a clause",
    clauses: ["main: (Maar) Jesse|wil|in de stad|wonen|niet in de trein"],
  },
  {
    sentence: "Ze begroet meneer Haddad hartelijk en vraagt hoe hij zich voelt.",
    about: "two main clauses, no word lost",
    hard: "the parser splits it into two sentences after begroet",
    clauses: [
      "main: Ze|begroet|meneer Haddad hartelijk||",
      "main: (en) |vraagt|||[…]",
      "sub: hoe|hij zich|voelt|",
    ],
  },
  {
    sentence:
      "Voorbeelden van dieren die veel voorkomen in de bergtoendra zone zijn berggeiten, fluithazen, chinchilla's, jaks en marmotten.",
    about: "a long subject with a relative clause",
    hard: "the parser reads zijn as a pronoun and the sentence as a phrase",
    clauses: [
      "main: Voorbeelden van dieren […]|zijn|berggeiten fluithazen chinchilla's jaks en marmotten||",
      "rel: die|veel|voorkomen|in de bergtoendra zone",
    ],
  },
  {
    sentence: "Ik zorg voor mijn ouders als ze oud worden.",
    about: "sub clause, its verb tagged as an infinitive",
    clauses: ["main: Ik|zorg|voor mijn ouders||[…]", "sub: als|ze oud|worden|"],
  },
  {
    sentence: "In de klas krijgt hij straf omdat hij niet oplet.",
    about: "sub clause with a joined separable verb",
    clauses: ["main: In de klas|krijgt|hij straf||[…]", "sub: omdat|hij niet|oplet|"],
  },
  {
    sentence: "Die avond, als hij het vuur aanmaakt, zingt hij zacht een liedje.",
    about: "sub clause inside the first place",
    clauses: [
      "main: Die avond […]|zingt|hij zacht een liedje||",
      "sub: als|hij het vuur|aanmaakt|",
    ],
  },
  {
    sentence: "Ik heb geprobeerd uw kantoor te bellen.",
    about: "te-clause without om",
    clauses: ["main: Ik|heb||geprobeerd|[…]", "sub: |uw kantoor|te bellen|"],
  },
  {
    sentence: "Zij wilden mij niet toestaan dat te doen.",
    about: "te-clause without om",
    clauses: ["main: Zij|wilden|mij niet|toestaan|[…]", "sub: |dat|te doen|"],
  },
  {
    sentence: "Aan wie gaf je de huissleutels?",
    about: "question with a preposition first",
    clauses: ["question: Aan wie|gaf|je de huissleutels||"],
  },
  {
    sentence: "Vraag Tom om morgen Mary mee te nemen.",
    about: "command, its verb tagged as an infinitive",
    hard: "the parser reads Vraag as a noun and Tom as the object of nemen",
    clauses: ["command: |Vraag|Tom||[…]", "sub: om|morgen Mary mee|te nemen|"],
  },
  {
    sentence:
      "Hij wilde geld sparen voor twee buffels, zodat hij met Adinda kon trouwen en een eigen leven kon beginnen.",
    about: "two sub clauses joined with en",
    clauses: [
      "main: Hij|wilde|geld|sparen|voor twee buffels […] […]",
      "sub: zodat|hij met Adinda|kon trouwen|",
      "sub: en|een eigen leven|kon beginnen|",
    ],
  },
  {
    sentence: "De verdachte is bewapend en gevaarlijk.",
    about: "a copula with adjectives",
    clauses: ["main: De verdachte|is|bewapend en gevaarlijk||"],
  },
  {
    sentence: "Dat zijn vrouwen in lange witte kleren.",
    about: "zijn as the verb",
    clauses: ["main: Dat|zijn|vrouwen in lange witte kleren||"],
    hard: "the parser reads zijn as a possessive",
  },
  {
    sentence: "Je had hem de waarheid moeten zeggen.",
    about: "two verbs in the verb end",
    clauses: ["main: Je|had|hem de waarheid|moeten zeggen|"],
  },
  {
    sentence: "Laten wij hier wachten tot ze terugkomt.",
    about: "tot as introducer",
    clauses: ["main: |Laten|wij hier|wachten|[…]", "sub: tot|ze|terugkomt|"],
  },
  {
    sentence: "Ik zal heel voorzichtig zijn.",
    about: "zijn as the verb end",
    clauses: ["main: Ik|zal|heel voorzichtig|zijn|"],
  },
  {
    sentence: "Dus ging ze slapen, maar ze sliep slecht.",
    about: "dus in the first place",
    clauses: ["main: Dus|ging|ze|slapen|", "main: (maar) ze|sliep|slecht||"],
  },
  {
    sentence: "Het water staat nu hoog, en van het slik is niets meer te zien.",
    about: "a second main clause with te",
    clauses: ["main: Het water|staat|nu hoog||", "main: (en) van het slik|is|niets meer|te zien|"],
  },
  {
    sentence: "Zijn stem was zo diep als de zee zelf.",
    about: "als that compares, no clause",
    clauses: ["main: Zijn stem|was|zo diep als de zee zelf||"],
  },
  {
    sentence: "Gelieve het vandaag af te halen.",
    about: "formal request",
    clauses: ["command: |Gelieve|het vandaag|af te halen|"],
    hard: "the parser reads Gelieve as a noun",
  },
  { sentence: "En boven op de kerk?", about: "fragment", clauses: [] },
  { sentence: "Een groot schip op zee.", about: "fragment", clauses: [] },
  {
    sentence: "Na een tijdje doet ze haar mond open.",
    about: "split verb, inversion",
    clauses: ["main: Na een tijdje|doet|ze haar mond|open|"],
  },
  { sentence: "Het is even stil.", about: "main", clauses: ["main: Het|is|even stil||"] },
  {
    sentence: "Daar groeit het nog steeds.",
    about: "inversion",
    clauses: ["main: Daar|groeit|het nog steeds||"],
  },
  {
    sentence: "Zo vertellen de mensen het in Kampen.",
    about: "inversion",
    clauses: ["main: Zo|vertellen|de mensen het in Kampen||"],
  },
  { sentence: "Ze doet niets meer.", about: "main", clauses: ["main: Ze|doet|niets meer||"] },
  { sentence: "Het touw zat te hard.", about: "main", clauses: ["main: Het touw|zat|te hard||"] },
  {
    sentence: "We gaan vanavond uit eten.",
    about: "verb end",
    clauses: ["main: We|gaan|vanavond|uit eten|"],
  },
  {
    sentence:
      "Door de eeuwen heen is het eilandje waarop de toren stond een schiereiland geworden vanwege aanslibbing vanuit de Nijl.",
    about: "long: relative inside, words after the verb end",
    clauses: [
      "main: Door de eeuwen heen|is|het eilandje […] een schiereiland|geworden|vanwege aanslibbing vanuit de Nijl",
      "rel: waarop|de toren|stond|",
    ],
  },
  {
    sentence:
      "In 1994 begon een Frans/Egyptische duikersploeg het gebied te onderzoeken en ontdekte grote steenblokken in zee die waarschijnlijk onderdelen waren van de vuurtoren.",
    about: "long: two main clauses, a relative in the second",
    clauses: [
      "main: In 1994|begon|een Frans/Egyptische duikersploeg het gebied|te onderzoeken|",
      "main: (en) |ontdekte|grote steenblokken in zee […]||",
      "rel: die|waarschijnlijk onderdelen|waren|van de vuurtoren",
    ],
  },
  {
    sentence: "Waar u ook maar wilt.",
    about: "a clause inside, alone",
    clauses: ["sub: Waar|u ook maar|wilt|"],
  },
  {
    sentence: "Houdt u niet van zwemmen?",
    about: "infinitive as a noun after van",
    clauses: ["question: |Houdt|u niet van zwemmen||"],
  },
  {
    sentence: "Ze zei dat ze zich gehaat voelde.",
    about: "dat hung on the participle",
    clauses: ["main: Ze|zei|||[…]", "sub: dat|ze zich|gehaat voelde|"],
  },
  {
    sentence: "Op de oude radio van Jan hoort Noor stemmen.",
    about: "noun or verb",
    clauses: ["main: Op de oude radio van Jan|hoort|Noor stemmen||"],
    hard: "stemmen can be a verb here too (hears Noor vote); the parser picks the verb",
  },
  {
    sentence: '"Nee, deze gaat naar Zwolle."',
    about: "interjection before the first place",
    clauses: ["main: deze|gaat|naar Zwolle||"],
    hard: "Nee has no part of its own yet",
  },
  {
    sentence: '"Was ik maar de zon."',
    about: "a wish, verb first",
    clauses: ["main: |Was|ik maar de zon||"],
  },
  {
    sentence:
      "Volgens het verhaal noemden de mensen de plek waar de wieg aan land kwam vanaf toen Kinderdijk.",
    about: "relative in the middle",
    clauses: [
      "main: Volgens het verhaal|noemden|de mensen de plek […] vanaf toen Kinderdijk||",
      "rel: waar|de wieg aan land|kwam|",
    ],
    hard: "the parser hangs Kinderdijk on kwam",
  },
  {
    sentence: "Betsy schrijft terug dat ze zich zorgen maakt, maar ze komt niet.",
    about: "zorgen is a noun",
    clauses: [
      "main: Betsy|schrijft||terug|[…]",
      "main: (maar) ze|komt|niet||",
      "sub: dat|ze zich zorgen|maakt|",
    ],
  },
  {
    sentence: "Maria sprong in Toms armen.",
    about: "a noun the parser calls a verb",
    clauses: ["main: Maria|sprong|in Toms armen||"],
  },
  {
    sentence: '"Dan moet je ze bellen!" roept Noor.',
    about: "a quote with ! before the reporting verb",
    clauses: ["main: […]|roept|Noor||", "main: Dan|moet|je ze|bellen|"],
  },
  {
    sentence: "Hij heeft vijf namen en vijf keer eten per dag.",
    about: "eten as a noun",
    clauses: ["main: Hij|heeft|vijf namen en vijf keer eten per dag||"],
    hard: "the parser makes eten the verb and heeft its helper",
  },
  {
    sentence:
      "Iedereen brengt zijn kleren naar een winkel waar je kunt wassen, twintig minuten lopen.",
    about: "a phrase after the comma",
    clauses: [
      "main: Iedereen|brengt|zijn kleren naar een winkel […] twintig minuten lopen||",
      "rel: waar|je|kunt wassen|",
    ],
    hard: "the parser reads twintig minuten lopen as a clause",
  },
];
