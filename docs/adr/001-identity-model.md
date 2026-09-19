# ADR 001 — One account per phone number

**Status:** accepted · **Date:** 2026-09-19 · **Phase:** 1

## Context

A person can be both a customer and a provider. A tow-truck driver registered
with us still has his own car, and it will break down. The recruitment flyer
also advertises roles (passenger transport) that are not services a customer
requests here, so "provider" is not simply "the set of services offered".

Two models were possible:

1. **Separate accounts per role** — one login for requesting, another for
   working.
2. **One identity per phone number**, with roles attached to it.

## Decision

**One identity per phone number.** `User.phone` is unique, and the role lives
on that single row.

- A first OTP login creates the user with `role = CUSTOMER`.
- Approving a provider application **promotes the existing user** to
  `role = PROVIDER`; it does not create a second account.
- `PROVIDER` permissions are a **superset** of `CUSTOMER` permissions
  (see `src/lib/auth/permissions.ts`), so a provider keeps the ability to
  create and track his own requests.
- Admins are the exception: they have no phone login at all. They sign in with
  email + password, and `User.phone` is null for them.

## Consequences

**Good**

- No duplicate people in the database, so ratings, history and fraud signals
  all attach to one record.
- Nobody has to remember which account they are on — a serious problem at the
  roadside, on a bad connection.
- Suspending a person suspends them everywhere at once. With two accounts, a
  blocked provider could still file requests.

**Costs and things to watch**

- The UI has to make the current context obvious: a provider looking at
  "my requests" must not confuse them with "my jobs".
- Promotion to `PROVIDER` is a privilege change, so it **must revoke all
  existing sessions** (`revokeAllUserSessions`). Otherwise an old cookie keeps
  serving the pre-promotion permission set.
- Demotion is the same in reverse, and must also drop the provider's
  availability flag so dispatch stops offering them.
- If we ever need one person under two businesses (say, two tow trucks with
  separate accounting), this model will not express it. We would add an
  organisation entity rather than a second user.

## Notes

Passenger transport (`سائق تكسي / نقل أشخاص`) is a **provider role only**, kept
in the `providerRoles` setting. It is deliberately not a `ServiceType`: it is
not roadside assistance, and it carries different licensing and liability.
