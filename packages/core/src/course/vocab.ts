/**
 * The words textbooks use for their structure, in the languages Kenning's users learn and read
 * instructions in. Course import recognises a unit ("Thema 3", "Chapter 3", "Lektion 3",
 * "Unité 3"), the contents page, exercise headers ("Oefening 4", "Exercise 4", "Übung 4") and
 * the appendices with these lists, so any book works, not only the Dutch example. Pure data.
 */

/** Words that introduce a numbered unit. */
export const UNIT_WORDS = [
  "Thema",
  "Hoofdstuk",
  "Les",
  "Deel",
  "Unit",
  "Chapter",
  "Lesson",
  "Module",
  "Part",
  "Lektion",
  "Kapitel",
  "Einheit",
  "Leçon",
  "Unité",
  "Chapitre",
  "Lección",
  "Unidad",
  "Capítulo",
  "Tema",
  "Lezione",
  "Unità",
  "Capitolo",
  "Lição",
  "Lekcja",
  "Rozdział",
  "Lektion",
  "Урок",
  "Розділ",
  "Тема",
  "Глава",
] as const;

/** Regex source matching one unit word (case-insensitive use expected). */
export const UNIT_WORD_SRC = `(?:${[...new Set(UNIT_WORDS)].join("|")})`;

/** Contents page headings. */
export const CONTENTS_HEADING_RE =
  /^(inhoud|inhoudsopgave|contents|table of contents|inhalt|inhaltsverzeichnis|table des matières|sommaire|índice|indice|sommario|spis treści|зміст|содержание|оглавление)\s*$/iu;

/** Words of an exercise header, besides the Dutch "Oefening" / "Opdracht" handled with OCR tolerance. */
export const EXERCISE_WORDS = [
  "exercise",
  "activity",
  "task",
  "übung",
  "aufgabe",
  "exercice",
  "activité",
  "ejercicio",
  "actividad",
  "esercizio",
  "attività",
  "exercício",
  "ćwiczenie",
  "zadanie",
  "вправа",
  "завдання",
  "упражнение",
  "задание",
] as const;

/** Appendix headings, by kind. */
export const APPENDIX_RE = {
  grammar:
    /^(grammatica|grammaticaal|grammatical|grammar|grammatik|grammaire|gramática|grammatica|gramatyka|граматика|грамматика)/iu,
  transcripts:
    /^(transcript|luisterteksten|hörtexte|transkript|transcriptions|transcripciones|audio scripts?)/iu,
  wordlist:
    /^(woordenlijst|woordenschat|vocabulary|glossary|word list|wortliste|wortschatz|glossar|lexique|vocabulaire|vocabulario|glosario|słownik|словник|словарь)/iu,
};

/** Front matter that is never a unit. */
export const FRONT_MATTER_RE =
  /^(voorwoord|inleiding|introductie|preface|introduction|foreword|colofon|colophon|vorwort|einleitung|avant-propos|préface|prólogo|prefazione|wstęp|передмова|предисловие)/iu;
