/**
 * Demo analyses for the sample texts, captured from the real NLP server (spaCy nl) so the
 * reader's "Grammar of this word" explains words in demo mode as it does with live data.
 * Per token: [start offset, pos, morph, dep, start offset of the head].
 */
type MorphRow = [number, string, string, string, number];

const SAMPLE_MORPH: Record<string, MorphRow[]> = {
  "t-utrecht": [
    [0, "PRON", "Case=Nom|Person=1|PronType=Prs", "nsubj", 3],
    [3, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 3],
    [7, "PRON", "Person=1|Poss=Yes|PronType=Prs", "nmod:poss", 12],
    [12, "NOUN", "Gender=Com|Number=Sing", "obj", 3],
    [16, "ADP", "", "compound:prt", 3],
    [18, "PUNCT", "", "punct", 3],
    [20, "PRON", "Person=3|PronType=Prs", "nsubj", 23],
    [23, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 23],
    [29, "ADP", "", "case", 32],
    [32, "PROPN", "Gender=Neut|Number=Sing", "obl", 23],
    [39, "PUNCT", "", "punct", 51],
    [41, "DET", "Definite=Ind", "det", 51],
    [45, "ADJ", "Degree=Pos", "amod", 51],
    [51, "NOUN", "Gender=Com|Number=Sing", "obj", 23],
    [56, "ADP", "", "case", 65],
    [60, "DET", "", "det", 65],
    [65, "NOUN", "Number=Plur", "nmod", 51],
    [73, "PUNCT", "", "punct", 23],
    [76, "ADV", "", "advmod", 84],
    [84, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 84],
    [90, "PRON", "Case=Nom|Person=3|PronType=Prs", "nsubj", 84],
    [94, "VERB", "Number=Sing|Tense=Past|VerbForm=Fin", "advmod", 84],
    [100, "ADP", "", "compound:prt", 84],
    [103, "SCONJ", "", "mark", 130],
    [109, "DET", "Definite=Def", "det", 112],
    [112, "NOUN", "Gender=Com|Number=Sing", "nsubj", 130],
    [118, "ADP", "", "case", 121],
    [121, "NUM", "", "obl", 130],
    [126, "NOUN", "Gender=Neut|Number=Sing", "fixed", 121],
    [130, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "advcl", 84],
    [138, "PUNCT", "", "punct", 84],
    [140, "PRON", "Person=3|PronType=Prs", "nsubj", 143],
    [143, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 143],
    [149, "DET", "Definite=Ind", "det", 153],
    [153, "NOUN", "Gender=Neut|Number=Sing", "obj", 143],
    [158, "ADP", "", "compound:prt", 143],
    [161, "PUNCT", "", "punct", 176],
    [163, "CCONJ", "", "cc", 176],
    [168, "DET", "Definite=Def", "det", 171],
    [171, "NOUN", "Gender=Com|Number=Sing", "nsubj", 176],
    [176, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "conj", 143],
    [182, "ADJ", "Degree=Pos", "advmod", 176],
    [186, "PUNCT", "", "punct", 143],
  ],
  "t-markt": [
    [0, "DET", "Definite=Def", "det", 3],
    [3, "NOUN", "Gender=Com|Number=Sing", "nsubj", 26],
    [9, "AUX", "Number=Sing|Tense=Pres|VerbForm=Fin", "cop", 26],
    [12, "DET", "", "det", 17],
    [17, "PROPN", "Gender=Com|Number=Sing", "obl", 26],
    [26, "ADJ", "Degree=Pos", "ROOT", 26],
    [30, "PUNCT", "", "punct", 26],
    [32, "PRON", "Person=1|Poss=Yes|PronType=Prs", "nmod:poss", 37],
    [37, "NOUN", "Gender=Com|Number=Sing", "nsubj", 47],
    [47, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 47],
    [53, "ADV", "", "advmod", 47],
    [58, "ADJ", "Degree=Pos", "amod", 64],
    [64, "NOUN", "Gender=Com|Number=Sing", "obj", 47],
    [69, "CCONJ", "", "cc", 72],
    [72, "NOUN", "Gender=Neut|Number=Sing", "conj", 64],
    [77, "PUNCT", "", "punct", 47],
    [80, "PRON", "Person=3|Poss=Yes|PronType=Prs", "nmod:poss", 85],
    [85, "NOUN", "Gender=Com|Number=Sing", "nsubj", 89],
    [89, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 89],
    [95, "NUM", "", "nummod", 100],
    [100, "NOUN", "Number=Plur", "obj", 89],
    [109, "CCONJ", "", "cc", 122],
    [112, "DET", "Definite=Ind", "det", 122],
    [116, "ADJ", "Degree=Pos", "amod", 122],
    [122, "NOUN", "Gender=Com|Number=Sing", "conj", 100],
    [126, "PUNCT", "", "punct", 89],
    [128, "DET", "Definite=Def", "det", 131],
    [131, "NOUN", "Gender=Com|Number=Sing", "nsubj", 136],
    [136, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 136],
    [142, "ADJ", "Degree=Pos", "advmod", 158],
    [147, "SCONJ", "", "mark", 158],
    [151, "PRON", "Person=3|PronType=Ind", "nsubj", 158],
    [158, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "xcomp", 136],
    [167, "PUNCT", "", "punct", 136],
  ],
  "t-weer": [
    [0, "PRON", "Person=3|PronType=Prs", "expl", 4],
    [4, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 4],
    [11, "ADV", "", "advmod", 4],
    [14, "NUM", "", "nummod", 19],
    [19, "NOUN", "Number=Plur", "obl", 4],
    [24, "PUNCT", "", "punct", 4],
    [26, "DET", "Definite=Def", "det", 29],
    [29, "NOUN", "Gender=Com|Number=Sing", "nsubj", 37],
    [34, "AUX", "Number=Sing|Tense=Pres|VerbForm=Fin", "cop", 37],
    [37, "ADJ", "Degree=Pos", "ROOT", 37],
    [42, "CCONJ", "", "cc", 57],
    [45, "DET", "Definite=Def", "det", 48],
    [48, "NOUN", "Gender=Com|Number=Sing", "nsubj", 57],
    [54, "AUX", "Number=Sing|Tense=Pres|VerbForm=Fin", "cop", 57],
    [57, "ADJ", "Degree=Pos", "conj", 37],
    [62, "PUNCT", "", "punct", 37],
    [65, "ADV", "", "advmod", 72],
    [72, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 72],
    [78, "PRON", "Person=3|PronType=Prs", "nsubj", 72],
    [82, "ADV", "", "advmod", 92],
    [92, "ADJ", "Degree=Cmp", "xcomp", 72],
    [97, "PUNCT", "", "punct", 99],
    [99, "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "parataxis", 72],
    [104, "DET", "Definite=Def", "det", 107],
    [107, "NOUN", "Gender=Com|Number=Sing", "nsubj", 99],
    [114, "PUNCT", "", "punct", 72],
  ],
};

/** Fill morph, dep and head (and pos where the mock lexicon has none) from the captured analysis. */
export function applySampleMorph<
  T extends { i: number; start: number; pos: string; morph: string; dep: string; head: number },
>(textId: string, tokens: T[]): void {
  const rows = SAMPLE_MORPH[textId];
  if (!rows) return;
  const byStart = new Map(tokens.map((t) => [t.start, t]));
  for (const [start, pos, morph, dep, headStart] of rows) {
    const t = byStart.get(start);
    const h = byStart.get(headStart);
    if (!t || !h) continue;
    t.morph = morph;
    t.dep = dep;
    t.head = h.i;
    if (t.pos === "X") t.pos = pos;
  }
}
