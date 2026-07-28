# The paid tier: design notes and open questions

**Status: not built, not decided.** Anchor is entirely free today and every
capability it ships is in the free tier. This document exists so that if a
commercial tier is ever added, the decision is made deliberately rather than
improvised — and so the reasoning is on record for whoever makes it.

---

## 1. The constraint that shapes everything

Anchor is MIT-licensed and its source is public. A license check in the client
can therefore be deleted and the project rebuilt in about four minutes.

This is not a flaw to be engineered around. It is the deal open source makes,
and pretending otherwise produces the worst of both worlds: obfuscation that
annoys honest users, and no real protection from anyone else.

The consequence is concrete and worth stating bluntly:

> **A license key establishes entitlement, not enforcement.** Anything whose
> value disappears the moment someone patches a boolean cannot be the product.

So the question is not "how do we stop people bypassing the check?" It is
**"what can we sell that a patched binary does not get?"**

That framing eliminates a lot of otherwise tempting ideas:

| Tempting idea                              | Why it fails                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Paid lint rules shipped in the npm package | The code is in the package. Patch the check, get the rules.          |
| Seat limits enforced client-side           | Nothing verifies the count. It is an honour system with extra steps. |
| "Pro" reporters or output formats          | Same package, same patch.                                            |
| Time-limited trials in the CLI             | Trivially bypassed, and it makes the free tool feel hostile.         |

---

## 2. What could actually be sold

Ranked by how well the value survives a patched client.

### Strong — value lives outside the client

**Hosted private rule packs.** A design system team writes organization-specific
rules; Anchor fetches them from a service the organization pays for. A patched
client still cannot fetch rules it has no credentials for. This is the most
defensible option and the most aligned with what large teams actually need,
because those rules encode internal decisions they do not want public anyway.

The obvious tension: Anchor's pitch is that nothing leaves your repo. A hosted
component has to be opt-in, clearly scoped (rules travel _to_ the client, code
never travels _out_), and honest in the marketing.

**Cross-repository dashboards.** Which teams are drifting, which rules fire
most, whether adoption is improving. This is genuinely a service — it needs
somewhere to aggregate, and aggregation is the product. Sells to the design
system owner rather than to the individual developer, which is also where the
budget is.

**Support, SLAs and design system consulting.** Unglamorous and unfashionable,
but it is what enterprises actually buy, it requires no technical enforcement,
and it scales with the maturity of the OSS project rather than against it.

### Medium — defensible but weaker

**Design tool integrations.** A Figma plugin that reports drift between the file
and the code. Value sits in the hosted half; the plugin is the client.

**Compliance artifacts.** Signed, timestamped reports that a design system was
enforced on a given commit. Only meaningful if someone else trusts the signature,
which means a service issues it.

### Weak — listed to be dismissed

Anything shipped in the npm package and gated by a flag. See the table above.

---

## 3. What must stay free, permanently

This is the part that should be hardest to change later, so it is written down
first. The following are promises, not current behaviour:

- **The eight built-in rules**, and the deterministic engine that runs them.
- **All six token formats**, and auto-detection.
- **`sync`** and every generated context file.
- **The GitHub Action**, including PR comments and annotations.
- **SARIF output**, so free users are not locked out of GitHub code scanning.
- **The BYOK LLM layer** — it costs Anchor nothing; the user pays their own
  provider.
- **Offline operation with no account.**

`FREE_FEATURES` in [entitlements.ts](../packages/core/src/license/entitlements.ts)
is the machine-readable version of this list. Removing an entry from it is
taking a capability away from users who already have it, and should be treated
as a breaking change requiring a major version and a very good reason.

---

## 4. How the mechanics would work

Already built, in `packages/core/src/license/`:

- **`verifyLicense(key)`** — Ed25519 signature check against a public key
  compiled into the build. No network, works air-gapped, works in ten years.
  Returns a structured failure rather than throwing, so an invalid license
  degrades to the free tier instead of breaking a lint run.
- **`getEntitlements()`** — the single gate. Reads a key from config or
  `ANCHOR_LICENSE_KEY`, and today returns identical features either way.
- **Key format** — `ANCHOR-1-<base64url payload>.<base64url signature>`, with a
  version segment so the payload can evolve.

Still to build, when and if there is something to sell:

- **Signing infrastructure.** The private key must live offline and never touch
  this repository or CI. `PRODUCTION_PUBLIC_KEY_SPKI_B64` is a deliberate
  placeholder; while it stays a placeholder no key verifies, which is the safe
  failure direction.
- **An issuing pipeline** — purchase to signed key, with a record of what was
  issued to whom.
- **Revocation.** The payload carries an `id` for exactly this, but offline
  verification cannot check a revocation list. Options: short expiry with
  renewal (simple, slightly annoying), or an optional online check for hosted
  features only (which they need anyway).

---

## 5. Open questions

Nobody has decided these. They are listed so the decision is visible when it is
made.

1. **Is a paid tier wanted at all?** Anchor may be more valuable to Eleva Builds
   as a demonstration of capability than as a revenue line. That is a legitimate
   outcome and should be chosen explicitly rather than by drift.
2. **Who is the buyer?** The developer who hits a violation and the design system
   lead who wants adoption metrics are different people with different budgets.
   The product changes depending on the answer.
3. **Does a hosted component undermine the privacy pitch?** "Nothing leaves your
   repo" is the strongest thing Anchor says. Any service must be structured so
   that sentence stays true — rules flow in, code never flows out — and the
   moment it needs an asterisk, the trade is probably not worth it.
4. **Open-core or fully free plus services?** Support and consulting need no
   licensing machinery at all. If that is the route, this entire seam is
   unnecessary and should be deleted rather than left to rot.

---

## 6. Technical debt this creates

Honest accounting of what exists and what it costs.

| Item                                   | State                    | Cost if never used                   |
| -------------------------------------- | ------------------------ | ------------------------------------ |
| `verify.ts`, `entitlements.ts`         | Built, tested (41 tests) | ~350 lines to delete                 |
| `license` field in `anchor.config`     | Accepted and validated   | A documented field that does nothing |
| `ANCHOR_LICENSE_KEY` in `.env.example` | Documented               | Mildly confusing to new users        |
| Placeholder public key                 | In place                 | None — it fails safe                 |

The seam is small and self-contained, which was the point: adding it now is
cheap, and adding it _later_ to a codebase with entitlement checks scattered
across a dozen call sites is where products acquire the bug where a customer
pays and still cannot use what they bought.

**If the decision is "free forever", delete `packages/core/src/license/`, the
`license` config field, and the `ANCHOR_LICENSE_KEY` entry, and keep this
document as the record of why.** A seam nobody intends to use is worse than no
seam, because future readers assume it is load-bearing.
