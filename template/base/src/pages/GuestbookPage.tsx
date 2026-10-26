import { useState } from "preact/hooks";
import { NoteDate } from "../components/NoteDate";
import type { GuestbookData, GuestbookEntry, GuestbookNotice } from "../shared/types";

// Example of a write: a form that works without JavaScript (plain POST → redirect back with ?notice=)
// and, once hydrated, submits with fetch() and adds the new entry in place.

const NOTICES: Record<GuestbookNotice, string> = {
  signed: "Thanks for signing!",
  invalid_name: "Please enter a name (up to 60 characters).",
  invalid_message: "Please enter a message (up to 500 characters).",
};

export function GuestbookPage({ data }: { data: GuestbookData }) {
  const [entries, setEntries] = useState(data.entries);
  const [notice, setNotice] = useState(data.notice);

  return (
    <section class="space-y-10">
      <header class="space-y-2">
        <h1 class="text-3xl font-semibold tracking-tight">Guestbook</h1>
        <p class="text-muted">Leave a note. Entries older than a year are removed by the scheduled job.</p>
      </header>

      <GuestbookForm
        notice={notice}
        onResult={(result) => {
          if (typeof result === "string") return setNotice(result);
          setEntries([result, ...entries]);
          setNotice("signed");
        }}
      />

      {entries.length === 0 ? (
        <p class="text-muted">No entries yet. Be the first.</p>
      ) : (
        <ul class="space-y-6">
          {entries.map((entry) => (
            <li key={entry.id} class="space-y-1">
              <p class="whitespace-pre-line">{entry.message}</p>
              <p class="text-sm text-muted">
                — {entry.name}, <NoteDate iso={entry.createdAt} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GuestbookForm({
  notice,
  onResult,
}: {
  notice: GuestbookNotice | null;
  onResult: (result: GuestbookEntry | GuestbookNotice) => void;
}) {
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const body = (await response.json()) as GuestbookEntry | { error: string };
      if (response.status === 201) {
        form.reset();
        onResult(body as GuestbookEntry);
      } else if ("error" in body && body.error in NOTICES) {
        onResult(body.error as GuestbookNotice);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const field = "w-full rounded border border-muted/40 bg-transparent px-3 py-2 focus:border-foreground focus:outline-none";
  return (
    <form method="post" action="/api/guestbook" onSubmit={submit} class="space-y-4">
      <label class="block space-y-1">
        <span class="text-sm font-medium">Name</span>
        <input name="name" required maxLength={60} autocomplete="name" class={field} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm font-medium">Message</span>
        <textarea name="message" required maxLength={500} rows={4} class={field} />
      </label>
      {/* Honeypot: hidden from people, filled in by naive bots. The server ignores posts that set it. */}
      <div class="hidden" aria-hidden="true">
        <input name="website" tabIndex={-1} autocomplete="off" />
      </div>
      <div class="flex items-center gap-4">
        <button
          type="submit"
          disabled={sending}
          class="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
        >
          {sending ? "Signing…" : "Sign"}
        </button>
        <p role="status" class="text-sm">
          {failed ? "Something went wrong. Please try again." : notice ? NOTICES[notice] : ""}
        </p>
      </div>
    </form>
  );
}
