import { BookText, Dumbbell, MessagesSquare } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@app/ui";

function Placeholder({
  icon,
  title,
  description,
  milestone,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  milestone: string;
}) {
  return (
    <div className="page page--narrow">
      <EmptyState
        icon={icon}
        title={title}
        description={`${description} Planned for ${milestone}.`}
      />
    </div>
  );
}

export function Practice() {
  return (
    <Placeholder
      icon={<Dumbbell size={28} />}
      title="Practice"
      description="One exercise at a time, drawn from the words in your texts: cloze, de or het, and separable verbs."
      milestone="M4"
    />
  );
}

export function Converse() {
  return (
    <Placeholder
      icon={<MessagesSquare size={28} />}
      title="Converse"
      description="Talk with a partner who keeps to words you know, with gentle corrections."
      milestone="M6"
    />
  );
}

export function Grammar() {
  return (
    <Placeholder
      icon={<BookText size={28} />}
      title="Grammar"
      description="Short topics with examples taken from the texts you have read."
      milestone="M5"
    />
  );
}
