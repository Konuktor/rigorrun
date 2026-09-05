# Examples

## `feedback-bundle.json`

What `rigorrun feedback export` produces, from a real session that connected a
real MCP server, taught it a job, and ran two agents against it — one of which
failed a connection test and one of which regressed.

It is here so that anybody deciding whether to send us one can see exactly what
they would be sending, without running anything.

The session it came from involved a project called "Bookings for Northwind
Halls", a goal mentioning a named person, a credential called `DESK_TOKEN` with
a live-looking value, a server called `venue-desk` publishing eight named tools,
and file paths from the machine it ran on. **None of that is in the file.** What
is in it: an opaque project id, the shape of the connector, counts, which stages
were reached and when, and the two things that went wrong — as classes, with no
messages, because a message carries a hostname.

Timestamps have been made regular so the committed copy does not churn; the
structure is verbatim.
