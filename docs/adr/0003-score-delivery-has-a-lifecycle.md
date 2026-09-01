# 3. Score delivery is an object with a lifecycle, and 409 is success

**Status:** accepted

## Context

The most common complaint about LTI tools is that grades do not appear. It is
almost never an outage: the request succeeded and the score is somewhere the
teacher is not looking.

One cause is subtle enough to cost days. An AGS score carries a timestamp, and a
platform rejects a score whose timestamp is not later than the one it already
holds. A retry that reuses the original timestamp therefore *can never succeed*,
and a naive retry loop runs forever.

## Decision

Every delivery is a row with a state (`pending`, `accepted`, `rejected`,
`superseded`), the timestamp sent, the HTTP status and the response body.
Timestamps are generated at send time and kept strictly increasing per user and
line item. **A 409 is recorded as `superseded` and treated as success.**

## Consequences

"Did it land?" is a query rather than a guess, the retry surface exists for
free, and a teacher can be shown per-score delivery state instead of silence.

Passback failure never loses work. The evidence lives in the tool's own
database; the gradebook gets a copy for the teacher's convenience. If a platform
is down for six hours, students keep working.
