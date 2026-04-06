# Repo Feedback

1. **Secrets committed to git**
   - **Problem**
     - Committed `.claude/settings.local.json` which contains secrets
   - **Solution**
     - Rotate keys, add `.claude/` to `.gitignore`, and use `git filter-repo --path .claude/settings.local.json --invert-paths` to scrub the file from all commits without losing repo history, then force-push
2. **PII data of ZA users reach US servers**
   - **Problem**
     - Raw documents containing PII of ZA users reach Anthropic's US servers to remove PII
   - **Comments**
     - Consult with Judith about this, the case we can make right now is:
       - We send raw uploaded document content to US servers in order to remove PII
       - The service receiving them claims https://trust.anthropic.com/ they offer API terms which state they don't train on API data, and a standard DPA (Data Processing Agreement) that may cover us to an extent.
       - Would be interesting to know if we could absolve `The Logbook` from liability with a well-worded TOS
   - **Solution**
     - The compliant production-ready approach is to move PII removal processing to a local model that we control within ZA, or to a provider which offers explicit POPIA/GDPR guarrantees
3. **Meilisearch allows malicious code to run in users browsers**
   - **Problem**
     - Search results rendering allowes Cross Site Scripting (XSS) attacks, meaning that a user could upload a document that when users search for it, malicious code hidden in that document would execute in other users browsers. That's because `v-html` renders Meilisearch highlighted results without sanitization
   - **Solution**
     - Sanitize with DOMPurify or apply highlighting client-side
4. **Rate limiting on public endpoints**
   - **Problem**
     - Invite claim and other public endpoints accept unlimited requests
   - **Solution**
     - Setup & configure Cloudflare to add protection rules against bots and IP-based rate limiting to public-facing routes
5. **Redirect logic allows users to be sent to malicious sites**
   - **Problem**
     - When the server redirects users (e.g. after claiming an invite), it builds the URL from information the browser sends rather than from the config. An attacker could manipulate this to redirect users to a malicious site (Server builds redirect URLs from the `Host` header instead of config)
   - **Solution**
     - Always use our configured `NUXT_PUBLIC_APP_URL` to build redirect URLs instead of trusting the browser's `Host` header
6. **No test harness**
   - **Problem**
     - Zero test coverage, risky given legal data context and how this is still early stage of development. It's critical to cover with tests now, to ensure vibe-coding and quick MVP development don't introduce issues or regressions
   - **Solution**
     - Add tests for critical paths: auth, document upload, RLS enforcement, PII compliance
7. **Google Drive folder ID validation**
   - **Problem**
     - `parseDriveFolderUrl` lacks max-length check on folder IDs
   - **Solution**
     - Add upper bound to the existing regex validation
8. **Nuxt/Vercel stack concerns (personal note)**
   - Not a bug, but a recommendation / preference on my side: frameworks like Nuxt/Next that tightly couple frontend and backend don't sit well with me. I prefer distinct separation and clear interfaces between client and server code. Nuxt's auto-import magic makes the codebase harder to reason about. Vercel as a platform I'm generally not a fan of either. Not a blocker, but wanted to make a note early-on, to consider alternatives before investing more in this approach.
9. **Missing for production readiness (beyond repo-level fixes)**
   - CI/CD pipeline — automated builds, tests, and deployments on push/merge
   - Environment management — proper staging environment separate from production
   - Monitoring and observability — error tracking (e.g. Sentry), uptime monitoring, logging aggregation
   - Alerting — get notified when things break, not when users complain
   - Database backups and disaster recovery plan
   - Cost controls — API usage budgets/caps for Anthropic, Voyage AI, Unstructured.io, Meilisearch Cloud
   - Concurrency and queuing — document processing pipeline needs a proper job queue, not fire-and-forget async calls. Same for users
   - Rate limiting and abuse protection (Cloudflare)
   - Secrets management — proper vault or environment management, not just `.env` files
   - Domain, SSL, and DNS setup under project control
   - Runbook documentation — what to do when the processing pipeline stalls, when Supabase goes down, etc.
   - Data retention and deletion policy (POPIA-GDPR requirement)
   - Incident response plan — who gets called, what gets done
   - Load testing — what happens when multiple users upload documents or search simultaneously (which will happen in cases of e.g. tenant meetings)
   - Telemetry — behavior tracking and user metrics to improve product
   - Feature flags — per-entity feature flags that would enable tiered features approach and A/B testing

# Roadmap Feedback

1. **Roadmap should include ops**
   - imo should add latest to Phase 2, ideally Phase 1 but that should be possible only if we receive funding early on as it's going to be costly
2. **Tests are important for Phase 2**
   - Phase 2 is a massive migration that cannot be done wihtout extensive tests support, adding `scheme_id` to every table and rewriting all RLS is essentially rebuilding the data layer. Needs its own migration plan, rollback strategy, and should not be attempted without the test harness in place first.
3. **PII/POPIA/GDPR compliance should be addressed in roadmap**
   - It's something many startups get wrong and a legal liability that should be addressed, likely even before scaling to more schemes
4. **Messaging apps extensions should be prioritized earlier in the roadmap**
   - IMO messaging apps integrations / extentions should be at an earlier stage
   - Regardless, better not call it "WhatsApp Bot" but "Messaging apps extensions" or at least "WhatsApp Extention", recommend to not specify so closely to WhatsApp at this stage
5. **Compliance Monitor needs legal guardrails before it ships**
   - Should be designed very deliberately to state points of facts, not compliance conclusions. E.g. better flag `no document on file matching requirement X` instead of saying `document non-compliant` which is a legal conclusion. The feature has real value but the wording, UI copy, and disclaimers are an important part of the product and Judith should be involved here.
6. **Unique angle but not empty space**
   - AI + ZA sectional title seems to indeed be unique but the space isn't empty, found these existing companies that do a quite similar thing:
     - https://www.condocontrol.com/
     - https://www.buildinglink.io/
   - I personally prefer it's not empty.
7. **A note on architecural approach**
   - We're building "A living, searchable institutional memory" / AI-enhanced knowledge base and collab space.
   - Product-side: we focus on the ZA sectional title schemes vertical
   - Codebase side: we build it as agnostic to the vertical as possible (generic naming for services, variables, folders, db tables, functions, etc. e.g. it's not `scheme_id` but `legal_entity_id` or `institution_id`)
   - This will dramatically increase our flexibility in case we need to pivot in the future, since it will be easily repackage-able into other verticals if necessary
