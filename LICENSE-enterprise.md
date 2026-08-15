# GitLaunch Enterprise License

## Notice

Copyright 2026 GitLaunch LLC. All rights reserved.

This license governs the Enterprise Features only. Everything else in this
repository is licensed under the [Functional Source License, Version 1.1, ALv2
Future License](LICENSE.md), and nothing here narrows that grant.

## Terms and Conditions

### Licensor ("We")

GitLaunch LLC.

### Enterprise Features

The "Enterprise Features" are:

1. the source files identified as covered by this license in
   [ENTERPRISE-PATHS.md](ENTERPRISE-PATHS.md), together with any file that
   carries a header naming this license; and

2. regardless of which files implement them, the following capabilities:

   a. operating more than one Account on an instance;

   b. admitting more than one User to an Account, including invitations,
   memberships, roles and seat management;

   c. single sign-on, including OIDC and SAML, and directory provisioning;

   d. subscription billing, plan tiers, plan limits and trial management; and

   e. issuing, verifying or administering GitLaunch license keys.

### License Grant

Subject to the Restrictions below, and for so long as you hold a current
Subscription that covers your use, we grant you a non-exclusive,
non-transferable, non-sublicensable right to use, copy, modify and create
derivative works of the Enterprise Features, for your internal use, up to the
Accounts and seats your Subscription names.

A "Subscription" is a paid agreement with us — a hosted plan on gitlaunch.com,
or a self-hosted license key we issued to you.

### Free Use Without a Subscription

Without a Subscription you may use the Enterprise Features:

1. with a single Account and a single User seat;

2. for development, evaluation and testing, in a non-production environment;
   and

3. for non-commercial education and non-commercial research.

A single-Account, single-seat instance is a supported configuration, not a
crippled one. We do not require you to register, to contact us, or to reach any
server we operate in order to run it.

### Restrictions

You may not:

1. use the Enterprise Features beyond one Account and one seat in a production
   environment without a Subscription;

2. remove, alter or obscure this license, the headers that name it, or the
   entries in ENTERPRISE-PATHS.md;

3. modify, disable or circumvent seat counting, entitlement resolution or
   license key verification in order to obtain use we have not sold you; or

4. redistribute the Enterprise Features, or make them available to any third
   party, except as part of professional services you provide to someone who
   holds their own Subscription.

Your right to read, modify and rebuild this source for your own instance is
deliberate — see the note on enforcement below. It does not extend to using the
result to exceed what your Subscription covers.

### Term and Termination

This license runs for as long as your Subscription does. If your Subscription
lapses, the grant in Free Use Without a Subscription continues to apply, and
any use beyond it must stop.

Expiry blocks growth, not operation. A lapsed self-hosted license does not take
an instance read-only and does not stop deployments already configured. That is
a deliberate product commitment, not an oversight: we do not hold a customer's
production pipeline hostage over a renewal.

### No Future License

The Grant of Future License in LICENSE.md — conversion to Apache 2.0 after two
years — does not apply to the Enterprise Features. They do not convert.

### Disclaimer

THE ENTERPRISE FEATURES ARE PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A
PARTICULAR PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
ENTERPRISE FEATURES, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL
DAMAGES, EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

This license grants no right to use our trademarks, trade names, service marks
or product names, except to identify us as the origin of the software.

### Governing Law

This license is governed by the laws of the Commonwealth of Puerto Rico,
without regard to its conflict of law provisions. The courts of San Juan,
Puerto Rico have exclusive jurisdiction.

### Contact

To buy a Subscription, or to ask whether something you want to do is covered:
<edgardo.g.carreras@gmail.com>.

---

## A note on enforcement

Not part of the terms above. Recorded here because being straight about it
leads to better decisions than pretending otherwise.

This source is available. A licensee can read it, patch out a seat check and
rebuild. No client-side scheme survives an adversary with root, and the usual
answers — phoning home, obfuscation — are exactly what our self-hosted and
air-gapped buyers will not accept.

So enforcement here is contractual, and what the boundary actually buys is:

- **No accidental overuse.** Nobody drifts past one seat without being told, and
  nobody can talk themselves into believing it was a supported configuration.
- **A clear line for a contract.** Exceeding it takes a deliberate act, which is
  what an audit clause and a legal remedy rest on.
- **A boundary a buyer can verify.** They can read exactly what they are paying
  for, which is worth more to a procurement reviewer than a promise.
