# Generation Pricing Recheck 2026-10-05

Current version: `2026-10-05-generation-v3`. Supersedes the conversion policy in the 2026-10-04 audit and Veo v1 audit. Historical confirmed quotes and task snapshots are not repriced.

## Evidence

Read [KIE official pricing](https://kie.ai/zh-CN/pricing) and its public `POST https://api.kie.ai/client/v1/model-pricing/page`: six pages, 524 records. No authentication or paid inference used. Existing supported Mini, Fast, Seedance 2, Wan 2.6/2.7, Kling 2.6/3 and Veo rates match the published USD amounts. KIE points are not platform wallet credits.

Veo is explicitly billed per video, not per second. 4/6/8 seconds retain the same cost within a tier and resolution. Wan 2.6 has explicit 5/10/15-second tiers. Seedance reference video bills input plus output seconds. Wan editing bills output seconds only.

## Approved Conversion Policy

The user explicitly removed the 20% buffer, keeping CNY 0.15 per output. Keep the existing fixed CNY 7.50/USD settlement budget; this is NOT a current market exchange-rate claim. Use the cheapest package unit price (CNY 139 / 1500 credits), round upward to one wallet credit, not five. Keep package allowances unchanged. This budget is not a guarantee of net profit or actual payment settlement cost.

## Current Per-Output Credits

| Model | Resolution | USD per second | 4 sec | 5 sec | 6 sec | 8 sec | 10 sec | 15 sec |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mini | 480p | 0.019 | 8 | 10 | 11 | 14 | 17 | 25 |
| Mini | 720p | 0.041 | 15 | 19 | 22 | 29 | 35 | 52 |
| Fast | 720p | 0.124 | 42 | 52 | 62 | 82 | 102 | 153 |
| Seedance 2 | 720p | 0.205 | 68 | 85 | 102 | 135 | 168 | 251 |
| Seedance 2 | 1080p | 0.510 | 167 | 209 | 250 | 332 | 415 | 621 |
| Kling 3 silent | 720p | 0.070 | 25 | 30 | 36 | 47 | 59 | 87 |
| Kling 3 audio | 720p | 0.100 | 34 | 43 | 51 | 67 | 83 | 124 |
| Kling 3 silent | 1080p | 0.090 | 31 | 39 | 46 | 60 | 75 | 111 |
| Kling 3 audio | 1080p | 0.135 | 46 | 57 | 68 | 90 | 111 | 166 |

Other supported combinations are generated from the same function in the user guide, preview button and server quote. The guide contains results only, not this calculation. Seedance 2 1080p 5 seconds costs USD 2.55 upstream; the resulting 209 platform credits are not a mistaken one-to-one copy of KIE points.

## Verification Boundary

Test wallet reservation, successful settlement, failure release, replay protection, pricing previews, and multilingual desktop/mobile UI with isolated databases and mocked provider responses. No real paid generation, production mutation, deployment, payment or refund was performed. These tests do not certify live provider invoices or output quality.
