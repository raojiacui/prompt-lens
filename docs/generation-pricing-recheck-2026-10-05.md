# Generation Pricing Recheck 2026-10-05

Current version: `2026-10-05-generation-v5`. Supersedes the conversion policy in the 2026-10-04 audit and Veo v1 audit. Historical confirmed quotes and task snapshots are not repriced.

## Evidence

Read [KIE official pricing](https://kie.ai/zh-CN/pricing) and its public `POST https://api.kie.ai/client/v1/model-pricing/page`: six pages, 524 records. No authentication or paid inference used. Existing supported Mini, Fast, Seedance 2, Wan 2.6/2.7, Kling 2.6/3 and Veo rates match the published USD amounts. KIE points are not platform wallet credits.

Veo is explicitly billed per video, not per second. 4/6/8 seconds retain the same cost within a tier and resolution. Wan 2.6 has explicit 5/10/15-second tiers. Seedance reference video bills input plus output seconds. Wan editing bills output seconds only.

Official OpenAPI sources rechecked for material routing:
- [Seedance Fast](https://docs.kie.ai/market/bytedance/seedance-2-fast): 4-15 seconds, 480p/720p only. 480p USD 0.059/sec (reference USD 0.034/sec). No advertised 1080p endpoint.
- [Kling 2.6 image](https://docs.kie.ai/market/kling/image-to-video): 5/10 seconds at 1080p; same USD 0.275/0.55 silent and 0.55/1.10 sound as text.
- [Wan 2.7 text](https://docs.kie.ai/market/wan/2-7-text-to-video): 2-15 seconds, `ratio` field.
- [Wan 2.7 image](https://docs.kie.ai/market/wan/2-7-image-to-video): 2-15 seconds, `first_frame_url` / optional `last_frame_url`.
- [Wan 2.7 reference](https://docs.kie.ai/market/wan/2-7-r2v): 2-10 output seconds, `reference_video` / `reference_image` arrays.
- [Wan 2.7 edit](https://docs.kie.ai/market/wan/2-7-videoedit): 2-10 input seconds; `video_url`, optional singular `reference_image`, duration 0 retains original length.

All four Wan 2.7 endpoints publish USD 0.08/sec at 720p and 0.12/sec at 1080p, charging output seconds only. Their five-second prices are 32/47 wallet credits; ten-second prices are 63/93. Model-family selection is independent of material modality. Editing remains a separate user intent.

## Approved Conversion Policy

The user explicitly removed the 20% buffer, keeping CNY 0.15 per output. The user explicitly approved a fixed CNY 7.00/USD conversion after rejecting the previous CNY 7.50 assumption; this is NOT a current market exchange-rate claim. Use the cheapest package unit price (CNY 139 / 1500 credits), round upward to one wallet credit, not five. Keep package allowances unchanged. This budget is not a guarantee of net profit or actual payment settlement cost.

## Current Per-Output Credits

| Model | Resolution | USD per second | 4 sec | 5 sec | 6 sec | 8 sec | 10 sec | 15 sec |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Mini | 480p | 0.019 | 8 | 9 | 11 | 14 | 16 | 24 |
| Mini | 720p | 0.041 | 15 | 18 | 21 | 27 | 33 | 49 |
| Fast | 720p | 0.124 | 40 | 49 | 58 | 77 | 96 | 143 |
| Seedance 2 | 720p | 0.205 | 64 | 80 | 95 | 126 | 157 | 234 |
| Seedance 2 | 1080p | 0.510 | 156 | 195 | 233 | 310 | 387 | 580 |
| Kling 3 silent | 720p | 0.070 | 23 | 29 | 34 | 44 | 55 | 81 |
| Kling 3 audio | 720p | 0.100 | 32 | 40 | 47 | 63 | 78 | 115 |
| Kling 3 silent | 1080p | 0.090 | 29 | 36 | 43 | 57 | 70 | 104 |
| Kling 3 audio | 1080p | 0.135 | 43 | 53 | 63 | 84 | 104 | 155 |

Other supported combinations are generated from the same function in the user guide, preview button and server quote. The guide contains results only, not this calculation. Seedance 2 1080p 5 seconds costs USD 2.55 upstream; the resulting 195 platform credits are not a mistaken one-to-one copy of KIE points.

## Verification Boundary

Test wallet reservation, successful settlement, failure release, replay protection, pricing previews, and multilingual desktop/mobile UI with isolated databases and mocked provider responses. No real paid generation, production mutation, deployment, payment or refund was performed. These tests do not certify live provider invoices or output quality.
