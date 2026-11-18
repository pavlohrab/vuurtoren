/**
 * Facts about the A2 inburgeringsexamen shown on the Exam overview, and the official links.
 * From docs/research/08-inburgering-a2.md; re-check them when `lastChecked` gets old.
 * Pass marks are not published on the pages we could check: `passEstimate` is an estimate.
 */
import type { ExamPart } from "./exam.js";

export interface ExamPartInfo {
  part: ExamPart;
  /** Dutch name, as on the official site. */
  nl: string;
  en: string;
  /** Official duration of the real exam. */
  minutes: number;
  /** How the real exam is taken. */
  format: string;
  /** Number of items in the real exam, as far as known ("about 25"). */
  items: string;
  /** Estimated share of points needed to pass (not an official figure). */
  passEstimate: number;
  /** Human-readable pass rule (an estimate). */
  passRule: string;
  marking: string;
}

export interface ExamSource {
  label: string;
  url: string;
}

export interface ExamInfo {
  id: string;
  title: string;
  /** When the facts were last checked against the official sources (YYYY-MM-DD). */
  lastChecked: string;
  parts: ExamPartInfo[];
  facts: string[];
  practiceUrl: string;
  sources: ExamSource[];
}

export const A2_EXAM: ExamInfo = {
  id: "nl-a2",
  title: "Inburgeringsexamen A2",
  lastChecked: "2026-11-18",
  parts: [
    {
      part: "lezen",
      nl: "Lezen",
      en: "Reading",
      minutes: 65,
      format:
        "On a computer. Short everyday texts (letters, signs, ads, timetables, e-mails) with multiple-choice questions.",
      items: "about 25 questions",
      passEstimate: 0.72,
      passRule: "about 18 of 25 (estimate)",
      marking: "Marked by computer.",
    },
    {
      part: "luisteren",
      nl: "Luisteren",
      en: "Listening",
      minutes: 45,
      format:
        "On a computer. Short videos and audio fragments (conversations, announcements) with multiple-choice questions.",
      items: "about 25 questions",
      passEstimate: 0.72,
      passRule: "about 18 of 25 (estimate)",
      marking: "Marked by computer.",
    },
    {
      part: "schrijven",
      nl: "Schrijven",
      en: "Writing",
      minutes: 40,
      format:
        "With pen and paper. Four tasks: fill in a form and write short messages, notes or e-mails.",
      items: "4 tasks",
      passEstimate: 0.65,
      passRule: "about 65% of the rubric points (estimate)",
      marking: "Marked by examiners with DUO's assessment model.",
    },
    {
      part: "spreken",
      nl: "Spreken",
      en: "Speaking",
      minutes: 35,
      format:
        "On a computer. You see a situation and record your spoken answer. Since 1 March 2025 there are no multiple-choice items.",
      items: "short and longer answers in several parts",
      passEstimate: 0.65,
      passRule: "not published (estimate: about two thirds of the rubric)",
      marking: "Marked by examiners with DUO's assessment model.",
    },
    {
      part: "knm",
      nl: "KNM",
      en: "Knowledge of Dutch society",
      minutes: 45,
      format:
        "On a computer. Situations from daily life (often with a picture or film) and multiple-choice questions on eight themes.",
      items: "about 40 questions",
      passEstimate: 0.7,
      passRule: "about 28 of 40 (estimate)",
      marking: "Marked by computer.",
    },
  ],
  /** Short facts for the overview, in plain English. */
  facts: [
    "People under the Wet inburgering 2013 take the language parts at A2. Under the Wet inburgering 2021 the standard is B1; the gemeente can lower it to A2 after at least 600 hours of lessons.",
    "Naturalisation currently asks for the A2 exam (or a higher diploma). The government plans to raise this to B1; no start date was set when we last checked.",
    "Each part costs €50 (ONA €40). You book through Mijn Inburgering on inburgeren.nl with DigiD, and you may retake a part.",
    "Results of Lezen, Luisteren and KNM usually come within 8 weeks; Spreken and Schrijven A2 currently take up to 16 weeks.",
  ],
  practiceUrl: "https://www.inburgeren.nl/examen-doen/oefenen.jsp",
  sources: [
    { label: "inburgeren.nl: which exams", url: "https://www.inburgeren.nl/examen-doen/" },
    {
      label: "inburgeren.nl: language exams A2",
      url: "https://www.inburgeren.nl/en/taking-the-integration-exam/content-language-exams-a2-b1-b2.jsp",
    },
    {
      label: "inburgeren.nl: KNM exam",
      url: "https://www.inburgeren.nl/en/taking-the-integration-exam/content-knowledge-exams.jsp",
    },
    { label: "inburgeren.nl: costs", url: "https://www.inburgeren.nl/en/paying-for-integration/" },
    {
      label: "inburgeren.nl: official practice exams",
      url: "https://www.inburgeren.nl/examen-doen/oefenen.jsp",
    },
    {
      label: "DUO: exams under the Wi2021",
      url: "https://duo.nl/zakelijk/inburgering-ketenpartners/wet-inburgering-2021/examens-wi2021/examen-doen-wi2021.jsp",
    },
    {
      label: "IND: civic integration for naturalisation",
      url: "https://ind.nl/en/dutch-citizenship/civic-integration-for-naturalisation",
    },
  ],
};

/** The overview facts of one part. */
export function examPartInfo(part: ExamPart): ExamPartInfo {
  const info = A2_EXAM.parts.find((p) => p.part === part);
  if (!info) throw new Error(`unknown exam part ${part}`);
  return info;
}
