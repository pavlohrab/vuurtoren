import { BookText, MessagesSquare } from "lucide-react";
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
