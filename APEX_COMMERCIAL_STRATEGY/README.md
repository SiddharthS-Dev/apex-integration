# APEX Commercial Strategy

_Inspironics APEX · Commercial Strategy · November 2026. Internal sales enablement._

> Readiness: capabilities marked LIVE are built and tested; none is yet proven in a customer production environment. No customer results, ROI, certifications or prices are claimed.

This folder is the commercial blueprint for taking Inspironics APEX to market. It is separate from the product code: nothing here changes any application, route, database or workflow.

## Contents
- `docs/`: strategy report, persona intelligence, educational material matrix, sales funnel, positioning, next steps
- `01_…` to `12_…`: one A0 poster each. Every folder has:
  - `*_A0.png`: 9933 × 14043 px, RGB, 300 DPI
  - `*_A0.pdf`: one page, 841 × 1189 mm
  - `source.svg`: the editable vector
- `APEX_Commercial_Infographics_Index.pdf`: an A4 index of the series
- `gallery/index.html`: an offline Infographic Gallery and Persona Explorer (open in a browser)
- `VALIDATION_REPORT.md`: the checks run on every file
- `_build/`: the generator; all content lives in `_build/content.mjs`

## Posters
| # | Poster | Files |
|---|---|---|
| 01 | Commercial Business Positioning | [PNG](01_Commercial_Positioning/APEX_Commercial_Positioning_A0.png) · [PDF](01_Commercial_Positioning/APEX_Commercial_Positioning_A0.pdf) · [SVG](01_Commercial_Positioning/source.svg) |
| 02 | Target Customer Segmentation | [PNG](02_Customer_Segmentation/APEX_Customer_Segmentation_A0.png) · [PDF](02_Customer_Segmentation/APEX_Customer_Segmentation_A0.pdf) · [SVG](02_Customer_Segmentation/source.svg) |
| 03 | Customer Persona Hierarchy | [PNG](03_Persona_Hierarchy/APEX_Persona_Hierarchy_A0.png) · [PDF](03_Persona_Hierarchy/APEX_Persona_Hierarchy_A0.pdf) · [SVG](03_Persona_Hierarchy/source.svg) |
| 04 | Persona Pain Points vs Business Value | [PNG](04_PainPoints_Value/APEX_PainPoints_Value_A0.png) · [PDF](04_PainPoints_Value/APEX_PainPoints_Value_A0.pdf) · [SVG](04_PainPoints_Value/source.svg) |
| 05 | What We Should Teach Each Persona | [PNG](05_Persona_Education/APEX_Persona_Education_A0.png) · [PDF](05_Persona_Education/APEX_Persona_Education_A0.pdf) · [SVG](05_Persona_Education/source.svg) |
| 06 | Persona-Based Educational Material Matrix | [PNG](06_Educational_Material_Matrix/APEX_Educational_Material_Matrix_A0.png) · [PDF](06_Educational_Material_Matrix/APEX_Educational_Material_Matrix_A0.pdf) · [SVG](06_Educational_Material_Matrix/source.svg) |
| 07 | Enterprise Sales Funnel | [PNG](07_Enterprise_Sales_Funnel/APEX_Enterprise_Sales_Funnel_A0.png) · [PDF](07_Enterprise_Sales_Funnel/APEX_Enterprise_Sales_Funnel_A0.pdf) · [SVG](07_Enterprise_Sales_Funnel/source.svg) |
| 08 | Customer Acquisition Journey | [PNG](08_Customer_Acquisition/APEX_Customer_Acquisition_A0.png) · [PDF](08_Customer_Acquisition/APEX_Customer_Acquisition_A0.pdf) · [SVG](08_Customer_Acquisition/source.svg) |
| 09 | Product Value Proposition | [PNG](09_Value_Proposition/APEX_Value_Proposition_A0.png) · [PDF](09_Value_Proposition/APEX_Value_Proposition_A0.pdf) · [SVG](09_Value_Proposition/source.svg) |
| 10 | Commercial Engagement Strategy | [PNG](10_Commercial_Engagement/APEX_Commercial_Engagement_A0.png) · [PDF](10_Commercial_Engagement/APEX_Commercial_Engagement_A0.pdf) · [SVG](10_Commercial_Engagement/source.svg) |
| 11 | Product Demonstration Strategy | [PNG](11_Product_Demonstration/APEX_Product_Demonstration_A0.png) · [PDF](11_Product_Demonstration/APEX_Product_Demonstration_A0.pdf) · [SVG](11_Product_Demonstration/source.svg) |
| 12 | Enterprise Buying Decision Journey | [PNG](12_Buying_Decision_Journey/APEX_Buying_Decision_Journey_A0.png) · [PDF](12_Buying_Decision_Journey/APEX_Buying_Decision_Journey_A0.pdf) · [SVG](12_Buying_Decision_Journey/source.svg) |

## Regenerate
Set TMP/TEMP to E: first (see AGENTS.md), then run from `_build/`:

```
node svg.mjs        # source.svg files and previews
node render.mjs     # PNG (vector-rendered in strips) and PDF (Chrome, vector)
node docs.mjs       # documents
node index.mjs      # index PDF and gallery
node validate.mjs   # checks and VALIDATION_REPORT.md
```

## Print notes
- The PDFs are vector RGB, at A0 page size with no bleed.
- No CMYK conversion tool is available in this environment. For offset printing, ask the print shop to convert the PDF to its CMYK profile (for example FOGRA39 or GRACoL), or export from `source.svg` in a CMYK-capable tool.
- Large-format inkjet printers accept the RGB PDF or PNG directly.
