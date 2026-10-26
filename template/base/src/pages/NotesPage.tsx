import { Link } from "../components/Link";
import { NoteDate } from "../components/NoteDate";
import type { NotesData } from "../shared/types";

export function NotesPage({ data }: { data: NotesData }) {
  return (
    <section class="space-y-8">
      <h1 class="text-3xl font-semibold tracking-tight">Notes</h1>
      {data.notes.length === 0 ? (
        <p class="text-muted">No notes yet.</p>
      ) : (
        <ul class="space-y-6">
          {data.notes.map((note) => (
            <li key={note.slug} class="space-y-1">
              <h2 class="text-xl font-medium">
                <Link href={`/notes/${encodeURIComponent(note.slug)}`} class="hover:underline underline-offset-4">
                  {note.title}
                </Link>
              </h2>
              <NoteDate iso={note.publishedAt} />
              <p>{note.excerpt}</p>
            </li>
          ))}
        </ul>
      )}
      <nav class="flex gap-6" aria-label="Pagination">
        {data.page > 1 && (
          <Link href={data.page === 2 ? "/notes" : `/notes?page=${data.page - 1}`} class="underline underline-offset-4">
            ← Newer
          </Link>
        )}
        {data.hasMore && (
          <Link href={`/notes?page=${data.page + 1}`} class="underline underline-offset-4">
            Older →
          </Link>
        )}
      </nav>
    </section>
  );
}
