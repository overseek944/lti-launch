# 2. Name and email are optional everywhere

**Status:** accepted

## Context

District policy, expressed in the platform as a privacy level, decides whether a
launch carries the user's name and email. In Moodle both default to **not
sent**. The tool receives a `sub` claim and nothing else identifying.

## Decision

`name` and `email` are nullable through the entire tool. The identifier is the
`sub` claim scoped to the deployment. The interface renders a fallback and says
plainly that the platform did not share a name.

## Consequences

The tool works under any privacy configuration, including the strictest.

The alternative, requiring a display name at user creation, produces one of two
failures: the launch errors for every student in the district, or the tool
creates a thousand users called "Unknown User" and cannot tell them apart.

Where names are genuinely needed, they come from Names and Role Provisioning,
which is a separate authorisation the administrator grants deliberately.
