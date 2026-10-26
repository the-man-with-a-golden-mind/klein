import { Link } from "../components/Link";
import { NoteDate } from "../components/NoteDate";
import type { NoteData } from "../shared/types";

export function NotePage({ data: { note } }: { data: NoteData }) {
  // The body is plain text; blank lines separate paragraphs.
  const paragraphs = note.body.split(/\n\s*\n/).filter((p) => p.trim() !== "");
  return (
    <article class="space-y-6">
      <header class="space-y-1">
        <h1 class="text-3xl font-semibold tracking-tight">{note.title}</h1>
        <NoteDate iso={note.publishedAt} />
      </header>
      <div class="space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <p>
        <Link href="/notes" class="underline underline-offset-4">
          ← All notes
        </Link>
      </p>
    </article>
  );
}
