# APEX Commercial Strategy Report

_Inspironics APEX · Commercial Strategy · November 2026. Internal sales enablement._

> Readiness: capabilities marked LIVE are built and tested; none is yet proven in a customer production environment. No customer results, ROI, certifications or prices are claimed.


## Executive summary

**The question this answers:** how we take APEX to market, identify the right decision makers, educate them, communicate value and sell it as an enterprise solution.

**The answer in brief:**
1. **What we sell.** An annual, self-hosted platform licence (front door and Core, plus modules) with an implementation package and a paid pilot as the entry point.
2. **Who buys.** Mid-sized engineering, technology-services and solution-integrator firms (about 200–5,000 people) that already store their know-how in Dropbox.
3. **Why they buy.** APEX turns know-how scattered across playbooks, decks and blueprints into a searchable portfolio, a ready sales library and certified team capability — behind one secure, self-hosted front door.
4. **How we sell.** We map each account to six personas plus governance. We educate each persona with its own material. We run a tailored demonstration, then convert interest into a **paid 8–12 week pilot** with written success criteria, and convert pilot evidence into an annual licence.
5. **What we must not do.** We must not claim customers, ROI, certifications, integrations or prices that do not exist. We must not present roadmap items (hosting, SSO, live Dropbox) as live.

## What APEX actually is (repository analysis)

APEX ("Inspironics APEX") is a **self-hosted** front door — a gateway with a dashboard — in front of three products. The organisation's files stay in its own Dropbox, and AI is optional.

| Module | What it does today | Status |
|---|---|---|
| APEX Front Door & Core | Single sign-in and sign-out across products, live status dashboard, cross-product search, Core identity with scoped roles, organisations, audit log and governed onboarding. | LIVE |
| Innovation Showcase | Curated library of 235 solution blueprints, search and filters, 3D ecosystem explorer, Daily Spotlight, usage analytics and a monthly PDF report. | LIVE |
| SlidesVault | Presentation library: ranked search, built-in viewer with page bookmarks, installable offline reading, view and reading-time analytics. | LIVE |
| Inspironics Academia | Playbooks become courses with server-graded tests, verifiable certificates, recertification when playbooks change, spaced review, and meetings turned into owned action items. | LIVE |

**Verified facts usable in sales material:** three products behind one front door; 235 solution blueprints in the Showcase library; 567 automated tests, all passing at the last full run; zero third-party dependencies in the gateway; four voice-over providers supported in Academia. These come from section 7 of the brochure input pack. The Academia development-database totals are not used, because they reflect internal use on one machine.

**Honest limits — these must shape every commercial claim:**
- Deployment is self-hosted only. There is no SaaS, no multi-tenancy and no production deployment yet; hosted Postgres with HTTPS is in progress.
- There is no enterprise SSO (SAML/OIDC) or MFA yet; both are on the roadmap.
- Dropbox, email delivery and Google sign-in have been tested against mocks only; a live Dropbox connection across all products is on the roadmap.
- No paying customer, customer production use, ROI study or certification is evidenced in the repository. **None may be claimed.**
- Personal-data export and erasure self-service are on the roadmap.

**Sources in this repository:** `docs/APEX_BROCHURE_INPUT_PACK.md` (feature inventory with LIVE / IN PROGRESS / ROADMAP status and evidence), `docs/APEX_MASTER_PLAN.md` (findings, personas, maturity), `docs/implementation/APEX_IMPLEMENTATION_STATUS.md`, `docs/adr/` and the product READMEs.

## Business and market analysis

### The problems that justify a purchase
- **Knowledge scattered across folders.** Blueprints, decks and playbooks sit in shared folders: hard to find, hard to present, and no one knows what is used.
- **Playbooks nobody learns from.** Engineering playbooks are written once and rarely read; there is no proof of who knows them or when they went out of date.
- **Too many tools, too many logins.** Each tool has its own address and password; access, roles and audit are inconsistent and hard to govern.

### Addressable segments (hypotheses to validate)
| Segment | Priority | Why APEX fits |
|---|---|---|
| Engineering & technology services | Primary | Playbook-to-course pipeline, recertification when playbooks change, meeting action items. |
| Solution & system integrators | Primary | Smart buildings, energy, IoT: Showcase taxonomy of 11 technologies and 8 industry zones for blueprints. |
| B2B technology pre-sales & sales | Primary | SlidesVault: find, present and measure the right deck, online or offline. |
| Dropbox-standardised organisations | Secondary | All products sync from Dropbox; files are proxied through APEX, never linked. |
| Organisations requiring self-hosting | Secondary | Regulated or IP-sensitive firms that keep data on their own servers. |
| Training & academic partners | Future | Future: student, intern and alumni journeys from the APEX master plan. |

| Organisation type | Fit |
|---|---|
| Mid-sized firms (200–5,000 people) | Primary: enough know-how to organise, fast decisions, one install. |
| Business units of large enterprises | Secondary: a division pilot that can expand. |
| Growing specialists (50–200 people) | Secondary: lighter package, fast onboarding of new hires. |
| Partners & integrators | Channel: resell, implement and convert content. |

**Commercial opportunities:**
- Land with one module where pain is sharpest (often SlidesVault for sales or Academia for engineering).
- Expand to the full front door once one team sees value.
- Content conversion services as recurring, high-trust revenue.
- Partner channel with integrators who already serve these industries.

Segments and size bands are hypotheses to validate in the first 10 discovery conversations.

## Positioning
See `05_APEX_Commercial_Positioning.md`. Positioning statement:

> For engineering and technology-services organisations whose know-how lives in playbooks, decks and blueprints, APEX is a self-hosted knowledge-to-capability platform that turns scattered material into a searchable portfolio, a ready sales library and verified team capability — behind one secure front door.

## Personas and the buying group
See `02_APEX_Customer_Persona_Intelligence.md` for the full 18-attribute profiles.

| Persona | Buying role | Decision authority | Influence |
|---|---|---|---|
| A — Executive Decision Makers | Economic Buyer | Final approval and budget owner | Very high |
| B — Senior Management | Business Decision Maker | Recommends and owns the business case | High |
| C — Business & Operations Leaders | Business Influencer · Champion | Shapes requirements; runs the pilot | Medium–high |
| D — Technology Decision Makers | Technical Evaluator | Technical approval or veto | High (can block) |
| E — Department-Level Users | End User | No budget; adoption decides renewal | Medium (adoption) |
| F — Strategic Business Partners | Channel · Influencer | Recommends to their clients | Medium–high (reach) |

## Customer education
See `03_APEX_Educational_Material_Matrix.md`. Every persona gets different material. Build first: product overview, executive infographic, business value presentation, persona demo videos, technical overview with security brief, and the pilot proposal.

## Sales funnel, engagement and conversion
See `04_APEX_Sales_Funnel.md`. The funnel has 15 stages, and the paid pilot (stage 9) is its pivot. There are four plays into an account: top-down, middle-out, technical-first and partner-led.

## Pricing framework
No prices are set. Recommended models and the information needed to set prices are in `05_APEX_Commercial_Positioning.md`.

## A0 infographic series
| # | Poster | Files |
|---|---|---|
| 01 | Commercial Business Positioning | `01_Commercial_Positioning/APEX_Commercial_Positioning_A0.png` · `.pdf` · `source.svg` |
| 02 | Target Customer Segmentation | `02_Customer_Segmentation/APEX_Customer_Segmentation_A0.png` · `.pdf` · `source.svg` |
| 03 | Customer Persona Hierarchy | `03_Persona_Hierarchy/APEX_Persona_Hierarchy_A0.png` · `.pdf` · `source.svg` |
| 04 | Persona Pain Points vs Business Value | `04_PainPoints_Value/APEX_PainPoints_Value_A0.png` · `.pdf` · `source.svg` |
| 05 | What We Should Teach Each Persona | `05_Persona_Education/APEX_Persona_Education_A0.png` · `.pdf` · `source.svg` |
| 06 | Persona-Based Educational Material Matrix | `06_Educational_Material_Matrix/APEX_Educational_Material_Matrix_A0.png` · `.pdf` · `source.svg` |
| 07 | Enterprise Sales Funnel | `07_Enterprise_Sales_Funnel/APEX_Enterprise_Sales_Funnel_A0.png` · `.pdf` · `source.svg` |
| 08 | Customer Acquisition Journey | `08_Customer_Acquisition/APEX_Customer_Acquisition_A0.png` · `.pdf` · `source.svg` |
| 09 | Product Value Proposition | `09_Value_Proposition/APEX_Value_Proposition_A0.png` · `.pdf` · `source.svg` |
| 10 | Commercial Engagement Strategy | `10_Commercial_Engagement/APEX_Commercial_Engagement_A0.png` · `.pdf` · `source.svg` |
| 11 | Product Demonstration Strategy | `11_Product_Demonstration/APEX_Product_Demonstration_A0.png` · `.pdf` · `source.svg` |
| 12 | Enterprise Buying Decision Journey | `12_Buying_Decision_Journey/APEX_Buying_Decision_Journey_A0.png` · `.pdf` · `source.svg` |

## Next steps
See `06_APEX_Next_Steps.md`.
