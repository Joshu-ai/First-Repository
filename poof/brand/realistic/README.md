# Realistic Puff

`brand/puff/real/` holds Puff as a sunlit cumulus cloud in all ten moods
(1536×1200). They were made here with an open image model on the CPU:
Stable Diffusion 1.5 + LCM-LoRA (both licensed for commercial use).

How they are made:

1. `node real_base.js <out> <moods…>` draws Puff as a real cloud (same
   silhouette, face and trail as `public/mascot.js`, but no outline, soft
   lit volume, blue sky). This keeps every result on-model.
2. `gen_puff.py` runs image-to-image on that base: a photoreal pass at
   768px (strength 0.6, 8 steps), then a 2× refine pass at 1536px
   (strength 0.3, 6 steps). Prompts go in `PUFF_BASE` / `PUFF_NEG`, the
   seed in `PUFF_SEED` (party uses seed 23; the rest seed 7).

Setup: `python3 -m venv gen && . gen/bin/activate && pip install torch
--index-url https://download.pytorch.org/whl/cpu && pip install diffusers
transformers accelerate safetensors peft pillow`. About 4 minutes per mood.

Where to use which Puff: the realistic set is for big, persuasive surfaces
(marketing, store listing). The app icon and everything small in the app
keep the flat vector Puff, which stays readable at 16px.
