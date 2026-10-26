// Fixed locale and time zone so server and browser render the same text.
const FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function NoteDate({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} class="text-sm text-muted">
      {FORMAT.format(new Date(iso))}
    </time>
  );
}
