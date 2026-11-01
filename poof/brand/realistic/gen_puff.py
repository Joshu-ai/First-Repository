# Generate polished Puff stills on CPU: SD 1.5 + LCM-LoRA, image-to-image from
# the code-drawn Puff so every result stays on-model.
# usage: python gen_puff.py <in_dir> <out_dir> <strength> <mood> [<mood> ...]
import os
import sys
import time

import torch
from diffusers import LCMScheduler, StableDiffusionImg2ImgPipeline
from PIL import Image

in_dir, out_dir, strength, *moods = sys.argv[1:]
strength = float(strength)
os.makedirs(out_dir, exist_ok=True)
torch.set_num_threads(4)

t0 = time.time()
pipe = StableDiffusionImg2ImgPipeline.from_pretrained(
    'stable-diffusion-v1-5/stable-diffusion-v1-5', torch_dtype=torch.float32, safety_checker=None,
)
pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
pipe.load_lora_weights('latent-consistency/lcm-lora-sdv1-5')
pipe.fuse_lora()
print(f'loaded in {time.time() - t0:.0f}s', flush=True)

BASE = os.environ.get('PUFF_BASE') or ('polished flat vector mascot illustration of a cute white cloud character with a bold even '
        'dark navy outline, smooth clean curves, soft lavender shading along the bottom, a trail of '
        'three lavender circles drifting off to the right, {face}, premium app icon style, crisp '
        'edges, centered, plain pure white background')
FACES = {
    'happy': 'two tall rounded dark pill-shaped eyes and a small curved smile',
    'wink': 'one tall pill-shaped eye, one closed winking eye, a small smile',
    'laugh': 'both eyes closed in happy arcs, wide open laughing mouth',
    'love': 'two red heart-shaped eyes and a small smile',
    'wow': 'two round eyes with white highlights and a small open oval mouth',
    'sad': 'sad pill-shaped eyes and a small frown, the trail drooping down',
    'sleepy': 'closed sleepy eyes and a tiny round mouth, small lavender z letters',
    'cool': 'dark sunglasses and a sideways smirk',
    'shy': 'small eyes glancing down, a tiny smile and pink blush on the cheeks',
    'party': 'closed happy eyes, open laughing mouth, a small coral party hat on top',
}
NEG = os.environ.get('PUFF_NEG') or ('photo, realistic, 3d render, texture, noise, blurry, jpeg artifacts, extra limbs, arms, legs, '
       'hands, text, letters, watermark, signature, frame, border, gradient background')

for mood in moods:
    src = Image.open(os.path.join(in_dir, f'{mood}.png')).convert('RGBA')
    bg = Image.new('RGBA', src.size, 'white')
    bg.alpha_composite(src)
    w, h = src.size
    k = float(os.environ.get('PUFF_SCALE', 1)); w, h = int(w * k), int(h * k)
    init = bg.convert('RGB').resize((w // 8 * 8, h // 8 * 8), Image.LANCZOS)
    t = time.time()
    g = torch.Generator().manual_seed(int(os.environ.get('PUFF_SEED', 7)))
    img = pipe(prompt=BASE.format(face=FACES[mood]), negative_prompt=NEG, image=init,
               strength=strength, num_inference_steps=int(os.environ.get('PUFF_STEPS', 6)), guidance_scale=1.5, generator=g).images[0]
    img.save(os.path.join(out_dir, f'{mood}.png'))
    print(f'{mood}: {time.time() - t:.0f}s', flush=True)
